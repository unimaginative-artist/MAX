import { RepoGraph } from '../../../core/RepoGraph.js';

function makeGraph() {
    return new RepoGraph({ /* minimal max stub — RepoGraph only uses max for logging */ });
}

describe('RepoGraph', () => {
    describe('addNode', () => {
        it('creates a node with correct fields', () => {
            const g = makeGraph();
            g.addNode('src/foo.js', { type: 'file', name: 'foo.js', lineCount: 42 });
            const node = g.nodes.get('src/foo.js');
            expect(node).toBeDefined();
            expect(node.id).toBe('src/foo.js');
            expect(node.type).toBe('file');
            expect(node.lineCount).toBe(42);
            expect(node.fanIn).toBe(0);
            expect(node.fanOut).toBe(0);
        });

        it('uses name attr as label when provided', () => {
            const g = makeGraph();
            g.addNode('src/bar.js', { name: 'bar.js' });
            expect(g.nodes.get('src/bar.js').label).toBe('bar.js');
        });

        it('falls back to id as label when name is absent', () => {
            const g = makeGraph();
            g.addNode('src/baz.js');
            expect(g.nodes.get('src/baz.js').label).toBe('src/baz.js');
        });

        it('merges attrs into an existing node without duplicating it', () => {
            const g = makeGraph();
            g.addNode('src/foo.js', { lineCount: 10 });
            g.addNode('src/foo.js', { lineCount: 99, extra: true });
            expect(g.nodes.size).toBe(1);
            expect(g.nodes.get('src/foo.js').lineCount).toBe(99);
            expect(g.nodes.get('src/foo.js').extra).toBe(true);
        });
    });

    describe('addEdge', () => {
        it('creates an edge between two nodes', () => {
            const g = makeGraph();
            g.addEdge('a.js', 'b.js', 'imports');
            expect(g.edges).toHaveLength(1);
            expect(g.edges[0]).toEqual({ source: 'a.js', target: 'b.js', type: 'imports' });
        });

        it('skips self-loops', () => {
            const g = makeGraph();
            g.addEdge('a.js', 'a.js');
            expect(g.edges).toHaveLength(0);
        });

        it('deduplicates identical edges', () => {
            const g = makeGraph();
            g.addEdge('a.js', 'b.js', 'imports');
            g.addEdge('a.js', 'b.js', 'imports');
            expect(g.edges).toHaveLength(1);
        });
    });

    describe('_calculateMetrics', () => {
        it('correctly counts fanIn, fanOut, and hubness', () => {
            const g = makeGraph();
            g.addNode('a.js');
            g.addNode('b.js');
            g.addNode('c.js');
            g.addEdge('a.js', 'b.js');
            g.addEdge('c.js', 'b.js');
            g._calculateMetrics();

            const a = g.nodes.get('a.js');
            const b = g.nodes.get('b.js');
            const c = g.nodes.get('c.js');

            expect(a.fanOut).toBe(1);
            expect(a.fanIn).toBe(0);
            expect(b.fanIn).toBe(2);
            expect(b.fanOut).toBe(0);
            expect(b.hubness).toBe(0); // fanIn * fanOut = 2 * 0
            expect(c.fanOut).toBe(1);
        });
    });

    describe('detectCycles', () => {
        it('finds a 3-node cycle', () => {
            const g = makeGraph();
            g.addNode('a.js'); g.addNode('b.js'); g.addNode('c.js');
            g.addEdge('a.js', 'b.js');
            g.addEdge('b.js', 'c.js');
            g.addEdge('c.js', 'a.js');
            const cycles = g.detectCycles();
            expect(cycles.length).toBeGreaterThan(0);
        });

        it('returns empty array for an acyclic graph', () => {
            const g = makeGraph();
            g.addNode('a.js'); g.addNode('b.js'); g.addNode('c.js');
            g.addEdge('a.js', 'b.js');
            g.addEdge('b.js', 'c.js');
            const cycles = g.detectCycles();
            expect(cycles).toHaveLength(0);
        });
    });
});
