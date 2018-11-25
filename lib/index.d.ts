import * as EventEmitter from "eventemitter3";
export { EventEmitter };
export default class Session extends EventEmitter {
    private endpoint;
    static getTransactionId: () => string;
    private handles;
    private destroyed;
    private destroying;
    private _id;
    readonly id: number;
    private polling;
    private connected;
    constructor(endpoint: string, start?: boolean, sessionId?: number);
    fullEndpoint(): string;
    poll(): void;
    attach(pluginId: string | number): Promise<any>;
    destroy(): Promise<void>;
}
export declare class Handle extends EventEmitter {
    private session;
    private _id;
    readonly id: number;
    constructor(session: Session, _id: number);
    private fullEndpoint();
    message(body: Object, jsep: Object): Promise<any>;
    trickle(candidates?: Array<Object> | Object): Promise<any>;
    hangup(): Promise<any>;
    destroy(): Promise<boolean>;
}
