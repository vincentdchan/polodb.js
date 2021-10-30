import path from 'path';
import net, { Socket } from 'net';
import { encode as encodeMsgPack } from '@msgpack/msgpack';
import child_process from 'child_process';

export interface Config {
  executablePath: string;
}

const defaultConfig: Config = {
  executablePath: path.join('../bin/polodb'),
};

interface RequestItem {
  reqId: number,
  resolve: (result: any) => void,
  reject: (err: Error) => void,
}

const REQUEST_HEAD = new Uint8Array([0xFF, 0x00, 0xAA, 0xBB])

class PoloDbClient {

  private __dbPath: string;
  private __socketPath: string;
  private __config: Config;
  private __process: child_process.ChildProcess;
  private __socket?: Socket;
  private __reqidCounter: number;
  private __promiseMap: Map<number, RequestItem> = new Map();

  public constructor(dbPath: string, config?: Partial<Config>) {
    this.__config = {
      ...defaultConfig,
      ...config,
    };

    const params: string[] = ['serve'];
    if (dbPath === 'memory') {
      params.push('--memory');
    } else {
      params.push('--path');
      params.push(dbPath);
    }

    this.__socketPath = `polodb-${Math.round(Math.random() * 0xFFFFFF)}.sock`;

    params.push('--socket');
    params.push(this.__socketPath);

    this.__process = child_process.spawn(
      this.__config.executablePath,
      params
    );

    this.__reqidCounter = Math.round(Math.random() * 0xFFFFFF);
  }

  private initSocketIfNotExist() {
    if (this.__socket) {
      return;
    }
    this.__socket = net.createConnection({
      path: this.__socketPath,
    });

    this.__socket.on('error', (err: Error) => {
      console.error(err);
    });

    this.__socket.on('close', () => {
      this.__socket = undefined;
    });
  }

  public find(collection: string, obj?: any): Promise<any> {
    this.initSocketIfNotExist();

    return new Promise((resolve, reject) => {
      const reqId = this.__reqidCounter++;
      this.__promiseMap.set(reqId, {
        reqId,
        resolve,
        reject,
      });

      const handleWrite = (err?: Error) => {
        if (!err) {
          return;
        }

        const item = this.__promiseMap.get(reqId);
        if (!item) {
          return;
        }

        this.__promiseMap.delete(reqId);

        item.reject(err);
      };

      this.__socket.write(REQUEST_HEAD, handleWrite);

      const reqIdBuffer = new ArrayBuffer(8);
      const reqIdView = new DataView(reqIdBuffer);
      reqIdView.setUint32(0, reqId);

      this.__socket.write(new Uint8Array(reqId), handleWrite);

      const requestObj = {
        cl: collection,
        query: obj,
      };
      const pack = encodeMsgPack(requestObj);

      this.__socket.write(pack, handleWrite);

      const zero = new Uint8Array([0]);
      this.__socket.write(zero, handleWrite);
    });
  }

  public dispose() {
    this.__process.kill();
  }

  get config(): Config {
    return { ...this.__config };
  }

}

export default PoloDbClient;