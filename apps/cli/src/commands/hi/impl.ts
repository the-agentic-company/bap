import type { LocalContext } from "../../context";

export default async function (this: LocalContext): Promise<void> {
  this.process.stdout.write("hi\n");
}
