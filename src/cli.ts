#!/usr/bin/env node
import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AuthStore } from "./auth.js";
import { loginFromHiddenPrompt, loginWithDedicatedBrowser, logoutLocal } from "./login.js";
import { runStdioServer } from "./server.js";

async function main(): Promise<void> {
  const [, , command] = process.argv;
  if (!command || command === "server" || command === "mcp") {
    await runStdioServer();
    return;
  }

  const program = new Command();
  program.name("b2match-mcp").description("Read-only MCP server and login helper for B2match").version("0.1.0");

  program
    .command("login")
    .argument("[event]", "B2match event URL, slug, or numeric id")
    .option("--paste", "Prompt for a session cookie without opening a browser")
    .description("Open a dedicated browser profile for Google login and capture the B2match session automatically.")
    .action(async (event: string | undefined, options: { paste?: boolean }) => {
      if (options.paste) {
        await loginFromHiddenPrompt(promptHidden, new AuthStore(), undefined, event);
        return;
      }
      if (!event) {
        throw new Error("login requires an event URL, slug, or numeric id unless --paste is used.");
      }
      await loginWithDedicatedBrowser(event);
    });

  program
    .command("logout")
    .option("--all", "Also delete the dedicated browser profile that keeps the Google session")
    .description("Delete the locally stored B2match token")
    .action(async (options: { all?: boolean }) => {
      await logoutLocal(options);
      if (options.all) {
        console.error("B2match token and dedicated browser profile removed.");
        return;
      }
      console.error("B2match token removed from local storage.");
    });

  program
    .command("status")
    .description("Show local B2match auth status without printing the token")
    .action(async () => {
      const status = await new AuthStore().status();
      console.log(JSON.stringify(status, null, 2));
    });

  await program.parseAsync(process.argv);
}

async function promptHidden(): Promise<string> {
  if (!input.isTTY) {
    const rl = createInterface({ input, output });
    const answer = await rl.question("Token: ");
    rl.close();
    return answer;
  }

  output.write("Token: ");
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");

  let value = "";
  try {
    for await (const chunk of input) {
      const text = String(chunk);
      for (const char of text) {
        if (char === "\r" || char === "\n") {
          output.write("\n");
          input.setRawMode(false);
          return value;
        }
        if (char === "\u0003") {
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    }
  } finally {
    if (input.isTTY) {
      input.setRawMode(false);
    }
  }

  return value;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`b2match-mcp: ${message}`);
  process.exit(1);
});
