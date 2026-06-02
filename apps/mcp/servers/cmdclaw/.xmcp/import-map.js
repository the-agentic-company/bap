
export const tools = {
"src/tools/chat.run.ts": () => import("../src/tools/chat.run.ts"),
"src/tools/coworker.get.ts": () => import("../src/tools/coworker.get.ts"),
"src/tools/coworker.create.ts": () => import("../src/tools/coworker.create.ts"),
"src/tools/coworker.list.ts": () => import("../src/tools/coworker.list.ts"),
"src/tools/coworker.logs.ts": () => import("../src/tools/coworker.logs.ts"),
"src/tools/coworker.run.ts": () => import("../src/tools/coworker.run.ts"),
"src/tools/coworker.runs.ts": () => import("../src/tools/coworker.runs.ts"),
};

export const prompts = {

};

export const resources = {

};

export const clientBundles = {

};

export const middleware = () => import("../src/middleware.ts");
