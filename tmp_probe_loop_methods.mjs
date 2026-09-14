import { AgentLoop } from './core/AgentLoop.js';
const methods = Object.getOwnPropertyNames(AgentLoop.prototype).filter(n => n !== 'constructor');
console.log('METHODS:' + JSON.stringify(methods, null, 2));
console.log('COUNT:' + methods.length);
