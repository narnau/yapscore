declare module "soundfont-player" {
  interface InstrumentPlayer {
    play(note: string, time: number, options?: { gain?: number; duration?: number }): AudioBufferSourceNode;
    stop(): void;
  }
  function instrument(
    context: AudioContext,
    name: string,
    options?: Record<string, unknown>
  ): Promise<InstrumentPlayer>;
  export default { instrument };
}
