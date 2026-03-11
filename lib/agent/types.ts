export type AgentResult =
  | { type: "load";   musicXml: string; name: string }
  | { type: "modify"; musicXml: string; message: string }
  | { type: "chat";   message: string };

export type ScoreCapture = {
  musicXml: string;
  name?: string;
  resultType: "load" | "modify";
};

export type AgentContext = {
  liveXml: string | null;
  capture: { result: ScoreCapture | null };
};
