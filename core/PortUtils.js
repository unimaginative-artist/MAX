import net from 'net';

/**
 * Returns true if the given TCP port is free on 127.0.0.1, false if already in use.
 */
export function checkPort(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(false));
        srv.once('listening', () => srv.close(() => resolve(true)));
        srv.listen(port, host);
    });
}
