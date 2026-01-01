import { openDirectory } from "./utils";

export default async function Command() {
  await openDirectory("/home/fbb/Pictures");
}
