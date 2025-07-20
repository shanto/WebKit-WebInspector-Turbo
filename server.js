const os = require("node:os");
const fs = require("fs");
const http = require("node:http");
const cluster = require("node:cluster");
const pty = require("@lydell/node-pty");
const path = require("path");
const { spawn } = require("child_process");
const which = require("which");

const PROXY_BIN = "ios_webkit_debug_proxy";
const WEBKIT_DR = "WebKit/Source/WebInspectorUI/UserInterface".replaceAll("/", path.sep);
const STATIC_DIR = [process.cwd(), WEBKIT_DR].join(path.sep);
const MIME_TYPES = {
	bin: "application/octet-stream",
	html: "text/html; charset=UTF-8",
	js: "text/javascript",
	css: "text/css",
	png: "image/png",
	jpg: "image/jpeg",
	gif: "image/gif",
	ico: "image/x-icon",
	svg: "image/svg+xml",
};
const numCPUs = Math.min(4, os.availableParallelism());
const PORT = process.env.PORT || 9220;

let proxy = undefined;

if (cluster.isPrimary) {
	console.log(`Primary ${process.pid} is running`);

	for (let i = 0; i < numCPUs; i++) {
		cluster.fork();
	}

	cluster.on("exit", (worker, code, signal) => {
		console.log(`Worker (http) ${worker.process.pid} died`);
	});

	which(PROXY_BIN).then((proxy_bin) => {
		let spawn_fn = process.stdout.isTTY ? pty.spawn : spawn;
		proxy = spawn_fn(proxy_bin, ["-f", `http://localhost:${PORT}/Main.html`]);
		proxy.on("data", (data) => {
			if (typeof data == "string") {
				if (data.match(/^[\x1b\x1bc]/gm)) {
					return;
				}
				data = data.trim().replace([/^\s*[\r\n]+/gm, /^\s*[\r\n]+$/gm], "");
				data.length && console.log("Proxy (ios): ", data);
			}
		});
	});

	console.log(`▷ http://localhost:${PORT + 1}/ ◁`);

	process.on("SIGINT", () => {
		console.log("Terminating all");
		process.exit(0);
	});
} else {
	http
		.createServer((req, res) => {
			let filePath = path.join(STATIC_DIR, req.url === "/Main.html" ? "Main.min.html" : req.url);
			const ext = path.extname(filePath).substring(1).toLowerCase();
			const mimeType = MIME_TYPES[ext] || MIME_TYPES.bin;
			if (req.url.includes("InspectorBackendCommands.js")) {
				filePath = filePath.replace("Protocol", "Protocol/Legacy/iOS/18.4".replace("/", path.sep));
				console.info(`Rewriting ${req.url}`);
			}
			let shortPath = filePath.replace(new RegExp(".+" + WEBKIT_DR.replaceAll(path.sep, ".")), "⌂");
			console.info(`${req.method}: ${req.url} (${shortPath})`);
			fs.readFile(filePath, (err, data) => {
				if (err) {
					res.writeHead(404, { "Content-Type": "text/plain" });
					res.end("404: File not found");
				} else {
					res.writeHead(200, { "Content-Type": mimeType });
					res.end(data);
				}
			});
		})
		.listen(PORT);

	console.log(`Worker (http) ${process.pid} started on port ${PORT}`);
}
