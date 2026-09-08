/* Like obsidian-stub, but requestUrl really talks to the network. */
export * from "./obsidian-stub";

export async function requestUrl(params: {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string | ArrayBuffer;
	throw?: boolean;
}): Promise<{ status: number; headers: Record<string, string>; text: string; json: unknown; arrayBuffer: ArrayBuffer }> {
	const response = await fetch(params.url, {
		method: params.method ?? "GET",
		headers: params.headers,
		body: params.body as BodyInit | undefined,
	});
	const buffer = await response.arrayBuffer();
	const text = new TextDecoder().decode(buffer);
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		json = undefined;
	}
	const headers: Record<string, string> = {};
	response.headers.forEach((value, key) => {
		headers[key.toLowerCase()] = value;
	});
	return { status: response.status, headers, text, json, arrayBuffer: buffer };
}
