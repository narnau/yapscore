import { useState, useCallback, useRef, useEffect } from "react";
import { capture } from "@/lib/telemetry/posthog";

export function useVoiceRecording(
  setInstruction: (text: string) => void,
  formRef: React.RefObject<HTMLFormElement | null>,
) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordingSecs, setRecordingSecs] = useState(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [micSupported, setMicSupported] = useState(false);

  useEffect(() => {
    setMicSupported(!!navigator.mediaDevices?.getUserMedia);
  }, []);

  const toggleRecording = useCallback(async () => {
    // Stop recording
    if (recording) {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      mediaRecorderRef.current?.stop();
      return;
    }

    // Start recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setRecordingSecs(0);

        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        if (blob.size === 0) return;
        capture("voice_recording_completed");

        setTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "recording");
          const res = await fetch("/api/transcribe", { method: "POST", body: form });
          const data = await res.json();
          if (data.transcript) {
            setInstruction(data.transcript);
            setTimeout(() => formRef.current?.requestSubmit(), 100);
          }
        } catch {
          // silently ignore transcription errors
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingSecs(0);
      setRecording(true);
      capture("voice_recording_started");
      recordingTimerRef.current = setInterval(() => setRecordingSecs((s) => s + 1), 1000);
    } catch {
      // microphone permission denied or unavailable
    }
  }, [recording, setInstruction, formRef]);

  return { recording, transcribing, recordingSecs, micSupported, toggleRecording };
}
