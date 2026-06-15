import net from 'net';

function tryBind(port, host) {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => { try { srv.close(); } catch {} resolve(false); });
        srv.once('listening', () => srv.close(() => resolve(true)));
        host ? srv.listen(port, host) : srv.listen(port);
    });
}

// Returns true only if the port is free on ALL relevant addresses.
// Probes both the specific host (e.g. 127.0.0.1) and the wildcard so that
// a process on ':::PORT' (IPv6 dual-stack) is also detected on Windows.
export async function checkPort(port, host = '127.0.0.1') {
    const checks = [tryBind(port, host)];
    // Only add the wildcard probe if not already checking the wildcard
    if (host !== '0.0.0.0' && host !== '::') checks.push(tryBind(port));
    const results = await Promise.all(checks);
    return results.every(Boolean);
}
