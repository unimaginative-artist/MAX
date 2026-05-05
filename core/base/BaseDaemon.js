
/**
 * BaseDaemon — Base class for autonomous background processes.
 */
export class BaseDaemon {
    constructor(max, name = 'BaseDaemon') {
        this.max  = max;
        this.name = name;
    }

    async start() {
        // To be implemented by subclasses
    }

    async stop() {
        // To be implemented by subclasses
    }
}
