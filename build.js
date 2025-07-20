const fs = require("fs");

const esbuild = require("esbuild");
const inlineImage = require("esbuild-plugin-inline-image");
const path = require("path");

const minJS = "Main.min.js";
const minCSS = "Main.min.css";
const minHTML = "Main.min.html";

process.chdir(process.cwd() + "/WebKit/Source/WebInspectorUI/UserInterface");

async function generateEntries() {
	const html = fs.readFileSync("Main.html", "utf-8");
	const scriptRegex = /<script\s+src="([^"]+)"\s*>/g;
	const linkRegex = /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>/g;

	const jsPaths = [];
	const cssPaths = [];

	let match;
	while ((match = scriptRegex.exec(html)) !== null) {
		let file = match[1];
		const basename = path.basename(file);
		if (["WebInspectorUIAdditions.js"].includes(basename)) {
			continue;
		}
		jsPaths.push(file);
	}

	jsPaths.push("External/Esprima/esprima.js");

	while ((match = linkRegex.exec(html)) !== null) {
		const file = match[1];
		const basename = path.basename(file);
		if (["WebInspectorUIAdditions.css"].includes(basename)) {
			continue;
		}
		cssPaths.push(file);
	}

	const jsEntry = jsPaths.map((p) => `import "./${p}";`).join("\n");
	const cssEntry = cssPaths.map((p) => `@import "./${p}";`).join("\n");

	console.log(`✅ In-memory JS entry with ${jsPaths.length} imports`);
	console.log(`✅ In-memory CSS entry with ${cssPaths.length} imports`);

	return { jsEntry, cssEntry };
}

function getGlobalsPatch(source) {
	var globalMembers = eslintGlobals.filter((glob) =>
		source.match(new RegExp(`(?:function|class|var) ${glob}[\s ]*(?:(?:[\n\r])|(?:[=\{\(]))`, "g"))
	);
	return globalMembers.map((glob) => `eval('globalThis.${glob} = ${glob}');`).join("\n");
}

const fixModules = {
	name: "fix-modules",
	setup(build) {
		build.onLoad({ filter: /.+\.js$/ }, async (args) => {
			let source = await fs.promises.readFile(args.path, "utf8");
			let patched = source;

			basename = path.basename(args.path);
			barename = path.basename(basename, path.extname(basename));
			dirname = path.basename(path.dirname(args.path));

			switch (basename) {
				case "OrbitControls.js":
					patched = `
                    eval('globalThis.THREE = import_three');
                    ${source}`;
					break;
				case "codemirror.js":
					patched = `
				    ${source};
				    eval('globalThis.CodeMirror = require_codemirror()');
				    `;
					break;
				case "esprima.js":
					patched = `
					// ${source};
					// eval('globalThis.esprima = require_esprima()');
					const esprima = require('esprima-next');
					eval('globalThis.esprima = esprima');
				    `;
					break;
			}

			switch (dirname) {
				case "Base":
				case "Views":
					var globals = getGlobalsPatch(source);
					patched = `
							    ${source};
							    ${globals}
							    `;
					break;
				case "CodeMirror":
					patched = patched.replace(
						/\(function\(mod\)\s*\{[\s\S]+?\}\)\(function\(CodeMirror\)/,
						"(function(CodeMirror)"
					);
					var globals = getGlobalsPatch(source);
					patched = `
                    ${patched};
                    ${globals}`;
			}

			return {
				contents: patched,
				loader: "js",
			};
		});
	},
};

const absolutePathFix = {
	name: "resolve-abs-paths",
	setup(build) {
		build.onResolve({ filter: /^\/.+/ }, (args) => {
			const resolvedPath = path.join(process.cwd(), args.path);
			return { path: resolvedPath };
		});
	},
};

async function rewriteHtml(inputFile, outputFile, jsPath, cssPath) {
	let html = await fs.promises.readFile(inputFile, "utf8");
	const scriptBlockRegex = /^[\s\t]*<script>([\s\S]*?)<\/script>(?=[ \t]*\r?\n?)/gm;

	html = html.replace(/^[\s\t]*<script\s+src="[^"]*"\s*><\/script>[\t\r\n]*/gm, "");
	html = html.replace(/^[\s\t]*<link\s+rel="stylesheet"\s+href="[^"]*"\s*\/?>[\t\r\n]*/gm, "");

	const injectBlock = `    <link rel="stylesheet" href="${cssPath}">\n    <script src="${jsPath}"></script>\n`;
	const injectCSS = `    <style> .tab-bar > .navigation-bar > .item.group > .item {height: 16px} .tab-bar > .navigation-bar > .item.group > .item.device-settings { display: none } </style>`;
	[injectBlock, injectCSS].forEach((block) => {
		html = html.replace(/<\/head>/, `${block}</head>`);
	});

	html = html.replace("; script-src ", "; script-src 'unsafe-eval' ");

	while ((match = scriptBlockRegex.exec(html))) {
		html = html.replace(`${match[0]}`, "");
		html = html.replace(/<\/head>/, `${match[0]}\n</head>`);
	}

	await fs.promises.writeFile(outputFile, html);
	console.log(`✅ Rewrote HTML: ${outputFile}`);
}

function getEslintGlobals(eslintPath = "../.eslintrc") {
	if (!fs.existsSync(eslintPath)) return [];

	const config = JSON.parse(
		fs
			.readFileSync(eslintPath, "utf8")
			.replaceAll(/[\s\t]*(\/*[^]*\*\/[\r\n]+)|(\/\/[^\r\n]+)/gm, "")
			.replaceAll(/,([\r\n\t ]+})/gm, "$1")
	);
	const globals = config.globals || {};
	return Object.keys(globals).concat(["IterableWeakSet", "isWebKitInjectedScript"]);
}

function allowEslintGlobalsPlugin(globals = []) {
	const globalSet = new Set(globals);

	return {
		name: "allow-eslint-globals",
		setup(build) {
			// Prevent esbuild from treating these as external module imports
			build.onResolve({ filter: /.*/ }, (args) => {
				if (globalSet.has(args.path)) {
					return { external: true }; // tell esbuild not to try resolving
				}
				return null;
			});
		},
	};
}

function cssImageVarsPlugin() {
	const usedVars = new Map(); // varName => file path
	const fragmentRefs = new Map(); // varName => { path, fragment }

	return {
		name: "css-image-vars",
		setup(build) {
			build.onLoad({ filter: /\.css$/ }, async (args) => {
				const contents = await fs.promises.readFile(args.path, "utf8");

				const urlRegex = /url\(([^)]+?\/)?([^/]+?\.(svg|png))(#[^)]+)?\)/gi;

				const rewritten = contents.replace(urlRegex, (match, pathPrefix = "", filename, ext, fragment = "") => {
					const extType = ext.toLowerCase();
					const baseName = path.basename(filename, `.${extType}`);
					const varName = `--${baseName.toLowerCase().replace(/[^a-z0-9]/gi, "-")}-${extType}`;
					const fullPath = path.resolve(path.dirname(args.path), pathPrefix || "", filename);

					if (fragment) {
						fragmentRefs.set(varName, { path: fullPath, fragment });
					} else {
						usedVars.set(varName, fullPath);
					}

					return `var(${varName})`;
				});

				return { contents: rewritten, loader: "css" };
			});

			build.onEnd(async (result) => {
				const cssOutput = result.outputFiles?.find((f) => f.path.endsWith(".css"));
				if (!cssOutput) {
					console.warn("⚠️ No CSS output found");
					return;
				}

				let cssText = cssOutput.text;
				const rootVars = [];

				const allVars = new Map([...usedVars, ...fragmentRefs]);

				for (const [varName, info] of allVars.entries()) {
					const filePath = typeof info === "string" ? info : info.path;
					const fragment = typeof info === "object" ? info.fragment || "" : "";

					if (!fs.existsSync(filePath)) {
						console.warn(`⚠️ Missing file: ${filePath}`);
						continue;
					}

					const ext = path.extname(filePath).slice(1).toLowerCase();
					const mimeType = ext === "svg" ? "image/svg+xml" : `image/${ext}`;
					const base64 = (await fs.promises.readFile(filePath)).toString("base64");

					const dataUri = `url("data:${mimeType};base64,${base64}${fragment}")`;
					rootVars.push(`  ${varName}: ${dataUri};`);
				}

				if (rootVars.length === 0) return;

				const rootBlock = `:root {\n${rootVars.join("\n")}\n}\n\n`;
				cssOutput.text = rootBlock + cssText;
				cssOutput.contents = Buffer.from(rootBlock + cssText); // ✅ this line is critical

				console.log(`✅ Injected ${rootVars.length} image variable(s) into in-memory CSS`);
			});
		},
	};
}

const eslintGlobals = getEslintGlobals();

// 🚀 Main build flow
(async () => {
	const { jsEntry, cssEntry } = await generateEntries();
	const allowGlobalsPlugin = allowEslintGlobalsPlugin(eslintGlobals);

	// JS build
	await esbuild
		.build({
			stdin: {
				contents: jsEntry,
				resolveDir: process.cwd(),
				loader: "js",
				sourcefile: "main-entry.js",
			},
			bundle: true,
			minify: false,
			write: false,
			platform: "browser",
			format: "iife",
			outfile: minJS,
			logLevel: "error",
			plugins: [inlineImage(), fixModules, allowGlobalsPlugin, absolutePathFix],
		})
		.then((result) => {
			const outJS = result.outputFiles.find((f) => f.path.endsWith(".js"));
			fs.writeFileSync(minJS, outJS.contents);
			console.log(`✅ Final JS written to ${minJS}`);
		});

	// CSS build
	await esbuild
		.build({
			stdin: {
				contents: cssEntry,
				resolveDir: process.cwd(),
				loader: "css",
				sourcefile: "main-entry.css",
			},
			bundle: true,
			minify: false,
			write: false, // ✅ critical for plugin to intercept output
			loader: {
				".css": "css",
				".svg": "file",
				".png": "file",
			},
			assetNames: "assets/[name]-[hash]",
			outfile: minCSS,
			logLevel: "error",
			plugins: [cssImageVarsPlugin(), absolutePathFix],
		})
		.then((result) => {
			const outCSS = result.outputFiles.find((f) => f.path.endsWith(".css"));
			fs.writeFileSync(minCSS, outCSS.contents);
			console.log(`✅ Final CSS written to ${minCSS}`);
		});

	await rewriteHtml("Main.html", minHTML, minJS, minCSS);

	console.log("✅ All builds complete");
})().catch((err) => {
	console.error("❌ Build failed:", err.message);
});
