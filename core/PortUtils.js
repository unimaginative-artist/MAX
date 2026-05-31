import net from 'net';

/**
 * Returns true if the given TCP port is free on 127.0.0.1, false if already in use.
 */
export function checkPort(port) {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(false));
        srv.once('listening', () => srv.close(() => resolve(true)));
        // No host: binds to the wildcard (:: on IPv6-enabled systems, same as the actual server).
        // Binding to '127.0.0.1' misses the case where another process holds :::PORT on Windows.
        srv.listen(port);
    });
}
