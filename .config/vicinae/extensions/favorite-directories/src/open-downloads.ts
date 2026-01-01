import { openDirectory } from "./utils";

export default async function Command() {
  await openDirectory("/mnt/storage/Downloads");
}
