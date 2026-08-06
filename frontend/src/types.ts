export interface SessionSummary {
  id: number;
  created_at: string;
  source_filename: string;
  mapping_filename: string | null;
  frame_count: number;
  id_count: number;
  error_count: number;
  suspicious_count: number;
  duration_seconds: number;
  notes: string;
}

export interface FrameOut {
  position: number;
  timestamp: number;
  can_id: string;
  dlc: number;
  data_hex: string;
  raw_line: string;
  is_error_frame: boolean;
  decoded_values: Record<string, number | string>;
}

export interface GroupedFrame {
  can_id: string;
  count: number;
  first_seen: number;
  last_seen: number;
  last_payload: string;
  error_count: number;
}

export interface SignalPoint {
  timestamp: number;
  value: number;
  frame_index: number;
  can_id: string;
  unit: string;
}

export interface AnomalyFinding {
  kind: 'error_frame' | 'signal_spike';
  timestamp: number;
  can_id: string;
  message: string;
  severity: 'high' | 'medium';
  signal?: string;
  previous_value?: number;
  current_value?: number;
  delta?: number;
}

export interface SessionDetail extends SessionSummary {
  grouped_frames: GroupedFrame[];
  signal_series: Record<string, SignalPoint[]>;
  anomalies: AnomalyFinding[];
  frames: FrameOut[];
}
