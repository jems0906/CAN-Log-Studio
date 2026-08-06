import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { listSessions, loadSession, uploadSession } from './api';
import type { FrameOut, SessionDetail, SessionSummary, SignalPoint } from './types';

const DEFAULT_MAPPING_TEXT = `{
  "messages": {
    "0x100": {
      "name": "Vehicle Speed",
      "signals": [
        { "name": "speed_kph", "start_byte": 0, "length": 2, "factor": 0.1, "offset": 0, "unit": "kph" }
      ]
    },
    "0x101": {
      "name": "Steering Angle",
      "signals": [
        { "name": "steering_deg", "start_byte": 0, "length": 2, "factor": 0.1, "offset": 0, "unit": "deg", "signed": true }
      ]
    },
    "0x102": {
      "name": "Brake Pressure",
      "signals": [
        { "name": "brake_pct", "start_byte": 0, "length": 1, "factor": 0.5, "offset": 0, "unit": "%" }
      ]
    },
    "0x103": {
      "name": "Throttle Position",
      "signals": [
        { "name": "throttle_pct", "start_byte": 0, "length": 1, "factor": 0.5, "offset": 0, "unit": "%" }
      ]
    }
  }
}`;

const SPEED_OPTIONS = [0.5, 1, 1.5, 2, 4];
const CHART_COLORS = ['#7ae7ff', '#f9b24e', '#ff7e7e', '#8ef0a2', '#c7a6ff'];

function App() {
  const logInputRef = useRef<HTMLInputElement>(null);
  const mappingFileRef = useRef<HTMLInputElement>(null);
  const [sessionList, setSessionList] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [searchText, setSearchText] = useState('');
  const [mappingText, setMappingText] = useState(DEFAULT_MAPPING_TEXT);
  const [notes, setNotes] = useState('Rivian-style CAN investigation session.');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayIndex, setReplayIndex] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadingSessions(true);
    listSessions()
      .then((items) => {
        if (!active) {
          return;
        }
        setSessionList(items);
        if (!selectedSessionId && items.length > 0) {
          setSelectedSessionId(items[0].id);
        }
      })
      .catch((thrownError: unknown) => {
        if (!active) {
          return;
        }
        setError(messageFromError(thrownError));
      })
      .finally(() => {
        if (active) {
          setLoadingSessions(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    let active = true;
    setLoadingDetail(true);
    loadSession(selectedSessionId)
      .then((session) => {
        if (!active) {
          return;
        }
        setDetail(session);
        setReplayIndex(0);
        setIsPlaying(false);
      })
      .catch((thrownError: unknown) => {
        if (!active) {
          return;
        }
        setError(messageFromError(thrownError));
      })
      .finally(() => {
        if (active) {
          setLoadingDetail(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedSessionId]);

  useEffect(() => {
    if (!detail) {
      return;
    }

    const frames = detail.frames;
    if (frames.length === 0 || !isPlaying) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | undefined;

    const playFrom = (index: number) => {
      if (cancelled) {
        return;
      }

      const nextIndex = index >= frames.length - 1 ? 0 : index + 1;
      setReplayIndex(index);
      const currentFrame = frames[index];
      const nextFrame = frames[nextIndex];
      const elapsedSeconds = Math.max(0.04, nextFrame.timestamp - currentFrame.timestamp || 0.05);
      const delayMs = Math.max(40, Math.min(1200, (elapsedSeconds * 1000) / replaySpeed));
      timeoutId = window.setTimeout(() => playFrom(nextIndex), delayMs);
    };

    playFrom(replayIndex);

    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [detail, isPlaying, replayIndex, replaySpeed]);

  useEffect(() => {
    if (detail) {
      setReplayIndex(Math.min(replayIndex, Math.max(detail.frames.length - 1, 0)));
    }
  }, [detail, replayIndex]);

  const chartRows = buildChartRows(detail?.signal_series ?? {});
  const activeFrames = detail?.frames ?? [];
  const currentFrame = activeFrames.length > 0 ? activeFrames[Math.min(replayIndex, activeFrames.length - 1)] : null;
  const totalDuration = detail?.duration_seconds ?? 0;
  const progressPercent = activeFrames.length > 1 ? Math.round((replayIndex / (activeFrames.length - 1)) * 100) : 0;
  const visibleFrames = activeFrames.filter((frame) => matchesSearch(frame, searchText));
  const anomalyMatches = detail?.anomalies.filter((finding) => matchesFinding(finding, searchText)) ?? [];

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const logFile = logInputRef.current?.files?.[0] ?? null;
    if (!logFile) {
      setError('Choose a CAN log file before uploading.');
      return;
    }

    const mappingFile = mappingFileRef.current?.files?.[0] ?? null;
    setUploading(true);
    try {
      const result = await uploadSession({
        logFile,
        mappingText,
        mappingFile,
        notes,
      });
      setDetail(result);
      setSelectedSessionId(result.id);
      setSessionList((current) => [toSummary(result), ...current.filter((session) => session.id !== result.id)]);
      setReplayIndex(0);
      setIsPlaying(false);
    } catch (thrownError: unknown) {
      setError(messageFromError(thrownError));
    } finally {
      setUploading(false);
    }
  };

  const replayLabel = currentFrame
    ? `${currentFrame.can_id} @ ${currentFrame.timestamp.toFixed(3)}s`
    : 'No frame selected';

  return (
    <div className="app-shell">
      <div className="aurora aurora-left" />
      <div className="aurora aurora-right" />

      <header className="hero panel">
        <div className="hero-copy">
          <p className="eyebrow">CAN debug and validation</p>
          <h1>CAN Log Studio</h1>
          <p className="hero-text">
            Upload vehicle logs, decode DBC-style signals, visualize speed and control traces,
            and replay the traffic to reproduce issues with a test-friendly workflow.
          </p>
          <div className="hero-badges">
            <span className="chip">React frontend</span>
            <span className="chip">FastAPI backend</span>
            <span className="chip">PostgreSQL-ready</span>
            <span className="chip">Replay + anomaly search</span>
          </div>
        </div>

        <div className="hero-status">
          <div className="stat-card stat-card-hero">
            <span className="stat-label">Active session</span>
            <strong>{detail ? detail.source_filename : 'No session loaded'}</strong>
            <span className="stat-note">
              {detail ? `Imported ${formatDate(detail.created_at)}` : 'Start by uploading a CAN log'}
            </span>
          </div>
          <div className="mini-grid">
            <div className="stat-card">
              <span className="stat-label">Frames</span>
              <strong>{detail?.frame_count ?? 0}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Signals</span>
              <strong>{Object.keys(detail?.signal_series ?? {}).length}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Anomalies</span>
              <strong>{detail?.suspicious_count ?? 0}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Duration</span>
              <strong>{formatDuration(totalDuration)}</strong>
            </div>
          </div>
        </div>
      </header>

      {error ? <div className="alert error">{error}</div> : null}

      <section className="content-grid">
        <aside className="panel sidebar-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Sessions</p>
              <h2>Recent imports</h2>
            </div>
            <span className="chip subtle">{loadingSessions ? 'Loading' : `${sessionList.length} saved`}</span>
          </div>

          <div className="session-list">
            {sessionList.length === 0 ? (
              <div className="empty-state compact">
                <strong>No uploads yet</strong>
                <p>Upload a log to create the first replayable investigation session.</p>
              </div>
            ) : (
              sessionList.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`session-card ${session.id === selectedSessionId ? 'selected' : ''}`}
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  <span className="session-title">{session.source_filename}</span>
                  <span className="session-meta">{formatDate(session.created_at)}</span>
                  <span className="session-stats">
                    {session.frame_count} frames · {session.id_count} ids · {session.suspicious_count} anomalies
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="upload-card">
            <div className="panel-header tight">
              <div>
                <p className="panel-kicker">Ingest</p>
                <h2>Upload log</h2>
              </div>
            </div>
            <form className="upload-form" onSubmit={handleUpload}>
              <label className="field">
                <span>CAN log file</span>
                <input ref={logInputRef} type="file" accept=".txt,.log,.csv,.json" />
              </label>
              <label className="field">
                <span>DBC-style mapping file</span>
                <input ref={mappingFileRef} type="file" accept=".json,.dbc,.txt" />
              </label>
              <label className="field">
                <span>Mapping JSON</span>
                <textarea
                  value={mappingText}
                  onChange={(event) => setMappingText(event.target.value)}
                  rows={14}
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span>Session notes</span>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
              </label>
              <button type="submit" className="primary-button" disabled={uploading}>
                {uploading ? 'Decoding...' : 'Upload and decode'}
              </button>
            </form>
          </div>
        </aside>

        <main className="main-panel">
          <section className="panel stats-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Overview</p>
                <h2>Session summary</h2>
              </div>
              <div className="controls-row">
                <span className={`chip ${loadingDetail ? 'subtle' : 'success'}`}>{loadingDetail ? 'Loading' : 'Ready'}</span>
                <label className="search-box">
                  <span>Search frames</span>
                  <input
                    type="search"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="ID, payload, decoded value..."
                  />
                </label>
              </div>
            </div>

            <div className="stat-grid">
              <div className="stat-card">
                <span className="stat-label">Frame count</span>
                <strong>{detail?.frame_count ?? 0}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Unique IDs</span>
                <strong>{detail?.id_count ?? 0}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Error frames</span>
                <strong>{detail?.error_count ?? 0}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Spike findings</span>
                <strong>{detail?.anomalies.length ?? 0}</strong>
              </div>
            </div>
          </section>

          <section className="panel chart-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Signals</p>
                <h2>Decoded timeline</h2>
              </div>
              <div className="controls-row compact-controls">
                <select value={replaySpeed} onChange={(event) => setReplaySpeed(Number(event.target.value))}>
                  {SPEED_OPTIONS.map((speed) => (
                    <option key={speed} value={speed}>
                      {speed}x
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setIsPlaying((current) => !current)}
                  disabled={activeFrames.length === 0}
                >
                  {isPlaying ? 'Pause replay' : 'Play replay'}
                </button>
              </div>
            </div>

            {chartRows.length > 0 ? (
              <div className="chart-frame">
                <ResponsiveContainer width="100%" height={360}>
                  <LineChart data={chartRows} margin={{ top: 16, right: 24, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(167, 180, 201, 0.18)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(value) => `${Number(value).toFixed(1)}s`}
                      stroke="#aebed8"
                    />
                    <YAxis stroke="#aebed8" />
                    <Tooltip
                      contentStyle={{
                        background: 'rgba(13, 17, 33, 0.94)',
                        border: '1px solid rgba(131, 148, 189, 0.35)',
                        borderRadius: '14px',
                        color: '#f5f8ff',
                      }}
                      labelFormatter={(value) => `Time ${Number(value).toFixed(3)}s`}
                    />
                    <Legend />
                    {Object.entries(detail?.signal_series ?? {}).map(([signalName, points], index) => {
                      const unit = points[0]?.unit ? ` (${points[0].unit})` : '';
                      return (
                        <Line
                          key={signalName}
                          type="monotone"
                          dataKey={signalName}
                          name={`${signalName}${unit}`}
                          stroke={CHART_COLORS[index % CHART_COLORS.length]}
                          strokeWidth={2.5}
                          dot={false}
                          isAnimationActive={false}
                        />
                      );
                    })}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="empty-state chart-empty">
                <strong>No decoded signals yet</strong>
                <p>Use a mapping file that matches the IDs in your log, then upload again.</p>
              </div>
            )}

            <div className="replay-panel">
              <div className="replay-header">
                <div>
                  <span className="stat-label">Replay cursor</span>
                  <strong>{replayLabel}</strong>
                </div>
                <span className="chip subtle">
                  {progressPercent}% of {activeFrames.length} frames
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(activeFrames.length - 1, 0)}
                value={Math.min(replayIndex, Math.max(activeFrames.length - 1, 0))}
                onChange={(event) => {
                  setReplayIndex(Number(event.target.value));
                  setIsPlaying(false);
                }}
              />
              <div className="replay-strip">
                <div className="replay-card">
                  <span className="stat-label">Current frame</span>
                  <strong>{currentFrame?.can_id ?? 'N/A'}</strong>
                  <span className="session-meta">
                    {currentFrame ? `${currentFrame.timestamp.toFixed(3)}s · DLC ${currentFrame.dlc}` : 'Awaiting data'}
                  </span>
                </div>
                <div className="replay-card">
                  <span className="stat-label">Decoded values</span>
                  <strong>{currentFrame ? summarizeDecodedValues(currentFrame) : 'No frame selected'}</strong>
                  <span className="session-meta">Move the slider to inspect each frame.</span>
                </div>
                <div className="replay-card">
                  <span className="stat-label">Session length</span>
                  <strong>{formatDuration(totalDuration)}</strong>
                  <span className="session-meta">Playback follows the frame timestamps.</span>
                </div>
              </div>
            </div>
          </section>

          <section className="panel grid-two">
            <div>
              <div className="panel-header tight">
                <div>
                  <p className="panel-kicker">Grouping</p>
                  <h2>Messages by ID</h2>
                </div>
              </div>
              <div className="table-card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>CAN ID</th>
                      <th>Count</th>
                      <th>First seen</th>
                      <th>Last seen</th>
                      <th>Errors</th>
                      <th>Last payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail?.grouped_frames ?? []).map((group) => (
                      <tr key={group.can_id}>
                        <td>{group.can_id}</td>
                        <td>{group.count}</td>
                        <td>{group.first_seen.toFixed(3)}s</td>
                        <td>{group.last_seen.toFixed(3)}s</td>
                        <td>{group.error_count}</td>
                        <td>{group.last_payload || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="panel-header tight">
                <div>
                  <p className="panel-kicker">Validation</p>
                  <h2>Errors and spikes</h2>
                </div>
                <span className="chip subtle">{anomalyMatches.length} matches</span>
              </div>
              <div className="finding-list">
                {anomalyMatches.length === 0 ? (
                  <div className="empty-state compact">
                    <strong>No anomaly hits</strong>
                    <p>Search for a CAN ID, signal name, or suspicious payload to narrow the findings list.</p>
                  </div>
                ) : (
                  anomalyMatches.map((finding, index) => (
                    <article key={`${finding.kind}-${index}-${finding.timestamp}`} className={`finding finding-${finding.severity}`}>
                      <div className="finding-top">
                        <strong>{finding.kind === 'error_frame' ? 'Error frame' : 'Signal spike'}</strong>
                        <span>{finding.timestamp.toFixed(3)}s · {finding.can_id}</span>
                      </div>
                      <p>{finding.message}</p>
                      {finding.kind === 'signal_spike' ? (
                        <span className="finding-meta">
                          {finding.signal}: {formatFindingValues(finding)}
                        </span>
                      ) : null}
                    </article>
                  ))
                )}
              </div>
            </div>
          </section>

          <section className="panel frame-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Frames</p>
                <h2>Filtered frame view</h2>
              </div>
              <span className="chip subtle">{visibleFrames.length} visible</span>
            </div>
            <div className="table-card frame-table-card">
              <table className="data-table frame-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Timestamp</th>
                    <th>CAN ID</th>
                    <th>DLC</th>
                    <th>Payload</th>
                    <th>Decoded</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleFrames.map((frame) => (
                    <tr key={`${frame.position}-${frame.timestamp}`} className={frame.is_error_frame ? 'error-row' : ''}>
                      <td>{frame.position}</td>
                      <td>{frame.timestamp.toFixed(3)}s</td>
                      <td>{frame.can_id}</td>
                      <td>{frame.dlc}</td>
                      <td>
                        <code>{frame.data_hex || '—'}</code>
                      </td>
                      <td>{summarizeDecodedValues(frame)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </section>
    </div>
  );
}

function toSummary(detail: SessionDetail): SessionSummary {
  return {
    id: detail.id,
    created_at: detail.created_at,
    source_filename: detail.source_filename,
    mapping_filename: detail.mapping_filename,
    frame_count: detail.frame_count,
    id_count: detail.id_count,
    error_count: detail.error_count,
    suspicious_count: detail.suspicious_count,
    duration_seconds: detail.duration_seconds,
    notes: detail.notes,
  };
}

function buildChartRows(signalSeries: Record<string, SignalPoint[]>): Array<Record<string, number | string>> {
  const rows = new Map<number, Record<string, number | string>>();

  Object.entries(signalSeries).forEach(([signalName, points]) => {
    points.forEach((point) => {
      const row = rows.get(point.timestamp) ?? { timestamp: point.timestamp };
      row[signalName] = point.value;
      rows.set(point.timestamp, row);
    });
  });

  return Array.from(rows.values()).sort((left, right) => Number(left.timestamp) - Number(right.timestamp));
}

function matchesSearch(frame: FrameOut, searchText: string) {
  const needle = searchText.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  const decoded = JSON.stringify(frame.decoded_values).toLowerCase();
  return [frame.can_id, frame.raw_line, frame.data_hex, decoded].some((value) => value.toLowerCase().includes(needle));
}

function matchesFinding(finding: { kind: string; message: string; can_id: string; signal?: string }, searchText: string) {
  const needle = searchText.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  return [finding.kind, finding.message, finding.can_id, finding.signal ?? ''].some((value) => value.toLowerCase().includes(needle));
}

function summarizeDecodedValues(frame: Pick<FrameOut, 'decoded_values'>) {
  const entries = Object.entries(frame.decoded_values);
  if (entries.length === 0) {
    return '—';
  }

  return entries
    .map(([signal, value]) => `${signal}: ${typeof value === 'number' ? value.toFixed(2) : value}`)
    .join(' • ');
}

function formatFindingValues(finding: FrameDetailFinding) {
  if (
    finding.kind !== 'signal_spike' ||
    finding.previous_value === undefined ||
    finding.current_value === undefined ||
    finding.delta === undefined
  ) {
    return 'No numeric delta available';
  }

  return `${finding.previous_value.toFixed(2)} → ${finding.current_value.toFixed(2)} (${finding.delta.toFixed(2)})`;
}

type FrameDetailFinding = SessionDetail['anomalies'][number];

function messageFromError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Something went wrong while processing the log.';
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0.0 s';
  }
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${minutes}m ${remaining.toFixed(1)}s`;
}

export default App;
