export abstract class AudioPlayer<T> {
    protected abstract sourceName: string;

    private _context: AudioContext;
    private _worklet: AudioWorkletNode | undefined;
    private _buffer: T[] = [];

    constructor(sampleRate: number) {
        this._context = new AudioContext({
            latencyHint: "interactive",
            sampleRate,
        });
    }

    protected abstract feedCore(worklet: AudioWorkletNode, source: T): void;

    public feed(source: T) {
        if (this._worklet === undefined) {
            this._buffer.push(source);
            return;
        }

        this.feedCore(this._worklet, source);
    }

    public async start() {
        await this._context.audioWorklet.addModule(
            new URL("./worker.js", import.meta.url)
        );

        this._worklet = new AudioWorkletNode(this._context, this.sourceName, {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
        });
        this._worklet.connect(this._context.destination);

        for (const source of this._buffer) {
            this.feedCore(this._worklet, source);
        }
        this._buffer.length = 0;
    }

    async stop() {
        this._worklet?.disconnect();
        this._worklet = undefined;

        await this._context.close();
    }
}

export class S16AudioPlayer extends AudioPlayer<Int16Array> {
    protected override sourceName = "s16-source-processor";

    protected override feedCore(worklet: AudioWorkletNode, source: Int16Array) {
        const { buffer } = source;
        worklet.port.postMessage(buffer, [buffer]);
    }
}

export class F32PlanerAudioPlayer extends AudioPlayer<Float32Array[]> {
    protected override sourceName = "f32-planer-source-processor";

    protected override feedCore(
        worklet: AudioWorkletNode,
        source: Float32Array[]
    ) {
        const buffers = source.map((channel) => channel.buffer);
        worklet.port.postMessage(buffers, buffers);
    }
}
