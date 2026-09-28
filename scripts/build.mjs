import { mkdir, copyFile, cp } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await copyFile("index.html", "dist/index.html");
await copyFile("LICENSE", "dist/LICENSE");
await cp("src", "dist/src", { recursive: true });
console.log("Built dist/ — deploy with any static web server.");
