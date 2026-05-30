import * as net from 'net';

// Guard: only patch once across all spec files in the same process.
const g = globalThis as { __httpSocketPatchApplied?: boolean };
if (!g.__httpSocketPatchApplied) {
  g.__httpSocketPatchApplied = true;

  // Track open sockets per server so we can destroy them immediately on
  // server.close(). Without this, keep-alive sockets linger after a test,
  // and if the OS recycles the freed port before the socket drains, the next
  // test's HTTP parser sees stale bytes and throws:
  //   "Parse Error: Expected HTTP/, RTSP/ or ICE/"
  const serverSockets = new WeakMap<net.Server, Set<net.Socket>>();

  const origListen = net.Server.prototype.listen;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (net.Server.prototype as any).listen = function (...args: any[]): net.Server {
    if (!serverSockets.has(this)) {
      const sockets = new Set<net.Socket>();
      serverSockets.set(this, sockets);
      // Disable keep-alive so sockets close immediately after each response.
      // Without this, the OS can serve stale keep-alive bytes to the next
      // test's HTTP parser even after socket destruction.
      if ('keepAliveTimeout' in this) {
        (this as { keepAliveTimeout: number }).keepAliveTimeout = 0;
        (this as { headersTimeout: number }).headersTimeout = 0;
      }
      // Bump max listeners so our extra listener doesn't trigger the warning
      this.setMaxListeners(this.getMaxListeners() + 1);
      this.on('connection', (socket: net.Socket) => {
        sockets.add(socket);
        socket.setMaxListeners(socket.getMaxListeners() + 1);
        socket.once('close', () => sockets.delete(socket));
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origListen as any).apply(this, args);
  };

  const origClose = net.Server.prototype.close;
  net.Server.prototype.close = function (
    cb?: (err?: Error) => void
  ): net.Server {
    const sockets = serverSockets.get(this);
    if (sockets) {
      for (const s of sockets) s.destroy();
      sockets.clear();
      serverSockets.delete(this);
    }
    return origClose.call(this, cb);
  };
}
