import { afterAll } from "bun:test";
import { runCleanups } from "./cleanup";

// A preload's afterAll runs once, after every test file in the run.
afterAll(runCleanups);
