import { defer } from "../defer";

describe("defer", () => {
  test("will return result", async () => {
    expect(await defer(() => "test")).toEqual("test");
  });
  test("will throw the original error", async () => {
    const err = new Error("bad");
    return expect(
      defer(() => {
        throw err;
      })
    ).rejects.toBe(err);
  });
});
