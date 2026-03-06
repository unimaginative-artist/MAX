import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { GoalEngine } from './GoalEngine.js';

jest.mock('fs');

describe('GoalEngine', () => {
    let brain;
    let outcomeTracker;
    let engine;

    beforeEach(() => {
        jest.clear