import { describe, expect, it } from "vitest";
import { createSseParser } from "./sse-parser";

describe("createSseParser", () => {
	it("parses a single event delivered in one chunk", () => {
		const parser = createSseParser();
		const events = parser.feed('id: 1\ndata: {"kind":"status"}\n\n');
		expect(events).toEqual([{ id: 1, data: '{"kind":"status"}' }]);
	});

	it("buffers a frame split across multiple chunks", () => {
		const parser = createSseParser();
		expect(parser.feed('id: 5\ndata: {"kind":')).toEqual([]);
		const events = parser.feed('"status"}\n\n');
		expect(events).toEqual([{ id: 5, data: '{"kind":"status"}' }]);
	});

	it("joins multi-line data fields with newlines", () => {
		const parser = createSseParser();
		const events = parser.feed("id: 2\ndata: line one\ndata: line two\n\n");
		expect(events).toEqual([{ id: 2, data: "line one\nline two" }]);
	});

	it("ignores comment lines used as heartbeats", () => {
		const parser = createSseParser();
		const events = parser.feed(':ping\n\nid: 3\ndata: {"kind":"status"}\n\n');
		expect(events).toEqual([{ id: 3, data: '{"kind":"status"}' }]);
	});

	it("drops a data block with no id", () => {
		const parser = createSseParser();
		const events = parser.feed('data: {"kind":"status"}\n\n');
		expect(events).toEqual([]);
	});

	it("strips trailing CR from CRLF line endings", () => {
		const parser = createSseParser();
		const events = parser.feed('id: 4\r\ndata: {"kind":"status"}\r\n\r\n');
		expect(events).toEqual([{ id: 4, data: '{"kind":"status"}' }]);
	});
});
