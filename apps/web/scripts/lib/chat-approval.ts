import { createReadStream, createWriteStream } from "node:fs";
import readline from "node:readline";
import { ask } from "./cli-shared";
import { resolveQuestionSelection, type QuestionApprovalItem } from "./question-approval";

export async function collectQuestionApprovalAnswers(
  rl: readline.Interface,
  questions: QuestionApprovalItem[],
): Promise<string[][]> {
  const collectOne = async (index: number): Promise<string[][]> => {
    if (index >= questions.length) {
      return [];
    }

    const question = questions[index]!;
    process.stdout.write(`\n[question] ${question.header}\n`);
    process.stdout.write(`${question.question}\n`);

    question.options.forEach((option, optionIndex) => {
      const suffix = option.description ? ` - ${option.description}` : "";
      process.stdout.write(`  ${optionIndex + 1}. ${option.label}${suffix}\n`);
    });

    if (question.custom) {
      process.stdout.write("  t. Type your own answer\n");
    }

    const prompt =
      question.options.length > 0
        ? question.multiple
          ? "Select option(s) comma-separated (default 1): "
          : "Select an option (default 1): "
        : "Answer: ";
    const rawSelection = (await ask(rl, prompt)).trim();

    let selectedAnswers: string[];
    if (question.custom && rawSelection.toLowerCase() === "t") {
      const typedPrompt = question.multiple
        ? "Type your answer(s) (comma-separated): "
        : "Type your answer: ";
      const typedAnswer = await ask(rl, typedPrompt);
      selectedAnswers = resolveQuestionSelection(question, typedAnswer);
    } else {
      selectedAnswers = resolveQuestionSelection(question, rawSelection);
    }

    const remaining = await collectOne(index + 1);
    return [selectedAnswers, ...remaining];
  };

  return collectOne(0);
}

function isReadlineOpen(rl: readline.Interface | null): rl is readline.Interface {
  if (!rl) {
    return false;
  }
  return !(rl as readline.Interface & { closed?: boolean }).closed;
}

export function createApprovalPrompt(rl: readline.Interface | null): {
  rl: readline.Interface;
  close: () => void;
} | null {
  if (isReadlineOpen(rl) && process.stdin.isTTY && process.stdout.isTTY) {
    return {
      rl,
      close: () => {},
    };
  }

  if (!process.stdout.isTTY) {
    return null;
  }

  try {
    const input = createReadStream("/dev/tty");
    const output = createWriteStream("/dev/tty");
    const ttyRl = readline.createInterface({ input, output });
    return {
      rl: ttyRl,
      close: () => {
        ttyRl.close();
        input.close();
        output.end();
      },
    };
  } catch {
    return null;
  }
}
