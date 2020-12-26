import _debug from "debug";
import net from "net";

import { IDiscoveredDevice } from "../discovery/model";
import { DiscoveryVersions } from "../protocol";
import { CancellableAsyncSink } from "../util/async";
import { BufferPacketProcessor } from "./base";

import {
    IDeviceProc,
    IDeviceProtocol,
    IDeviceSocket,
    IPacket,
    IPacketCodec,
    ISocketConfig,
    PlaintextCodec,
} from "./model";
import { DeviceProtocolV1 } from "./protocol/v1";

const socketPortsByVersion = {
    [DiscoveryVersions.PS4]: 997,
    [DiscoveryVersions.PS5]: undefined,
};

const protocolsByVersion = {
    [DiscoveryVersions.PS4]: DeviceProtocolV1,
    [DiscoveryVersions.PS5]: undefined,
};

const debug = _debug("playground:socket:tcp");

export class TcpDeviceSocket implements IDeviceSocket {
    public static connectTo(
        device: IDiscoveredDevice,
        config: ISocketConfig,
    ) {
        const port = socketPortsByVersion[device.discoveryVersion];
        if (!port) {
            throw new Error(`No port known for protocol ${device.discoveryVersion}`);
        }

        const protocol = protocolsByVersion[device.discoveryVersion];
        if (!protocol) {
            throw new Error(`No protocol known version ${device.discoveryVersion}`);
        }

        return new Promise<TcpDeviceSocket>((resolve, reject) => {
            const socket = net.createConnection({
                port,
                host: device.address,
                timeout: config.connectTimeoutMillis,
            });
            socket.once("connect", () => {
                socket.removeAllListeners("error");
                resolve(new TcpDeviceSocket(device, protocol, socket));
            });
            socket.once("error", err => {
                reject(err);
            });
        });
    }

    private readonly receivers: CancellableAsyncSink<IPacket>[] = [];
    private codec: IPacketCodec = PlaintextCodec;
    private readonly processor: BufferPacketProcessor;

    constructor(
        public readonly device: IDiscoveredDevice,
        private readonly protocol: IDeviceProtocol,
        private readonly stream: net.Socket,
    ) {
        this.processor = new BufferPacketProcessor(
            protocol,
            this.codec,
            packet => {
                for (const receiver of this.receivers) {
                    receiver.write(packet);
                }
            },
        );

        stream.on("end", () => {
            for (const receiver of this.receivers) {
                receiver.end();
            }
        });
        stream.on("error", err => {
            for (const receiver of this.receivers) {
                receiver.end(err);
            }
        });
        stream.on("data", data => {
            debug("<<", data);
            this.processor.onDataReceived(data);
        });
    }

    public get protocolVersion() {
        return this.protocol.version;
    }

    public execute<R>(proc: IDeviceProc<R>): Promise<R> {
        return proc.perform(this);
    }

    public receive(): AsyncIterable<IPacket> {
        const receiver = new CancellableAsyncSink<IPacket>();
        receiver.onCancel = () => {
            const idx = this.receivers.indexOf(receiver);
            if (idx !== -1) {
                this.receivers.splice(idx, 1);
            }
        };

        this.receivers.push(receiver);
        return receiver;
    }

    public send(packet: IPacket) {
        const buffer = packet.toBuffer();
        const encoded = this.codec.encode(buffer);

        if (encoded === buffer) {
            debug(">>", packet, "(", buffer, ")");
        } else {
            debug(">>", packet, ": ", buffer);
        }

        return new Promise<void>((resolve, reject) => {
            this.stream.write(encoded, err => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    public setCodec(codec: IPacketCodec) {
        debug("switch to codec:", codec);
        this.codec = codec;
        this.processor.codec = codec;
    }

    public async close() {
        // TODO we can send the "bye" packet here for a nicer cleanup
        this.stream.destroy();
    }
}