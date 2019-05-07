import { memoize2, memoize3, memoize4 } from "../memoize";

describe("memoize", () => {
  describe("2 params", () => {
    const effectCheck = jest.fn();
    function add(a: number, b: number) {
      effectCheck();
      return a + b;
    }
    afterEach(() => {
      effectCheck.mockReset();
    });
    test("should call effect only once", () => {
      const memoizedAdd = memoize2(add);
      memoizedAdd(1, 2);
      memoizedAdd(1, 2);
      memoizedAdd(1, 2);
      memoizedAdd(1, 2);
      expect(effectCheck).toHaveBeenCalledTimes(1);
    });
  });

  describe("3 params", () => {
    const effectCheck = jest.fn();
    function add(a: number, b: number, c: number) {
      effectCheck();
      return a + b + c;
    }
    afterEach(() => {
      effectCheck.mockReset();
    });
    test("should call effect only once", () => {
      const memoizedAdd = memoize3(add);
      memoizedAdd(1, 2, 3);
      memoizedAdd(1, 2, 3);
      memoizedAdd(1, 2, 3);
      memoizedAdd(1, 2, 3);
      expect(effectCheck).toHaveBeenCalledTimes(1);
    });
  });

  describe("4 params", () => {
    const effectCheck = jest.fn();
    function add(a: number, b: number, c: number, d: number) {
      effectCheck();
      return a + b + c + d;
    }
    afterEach(() => {
      effectCheck.mockReset();
    });
    test("should call effect only once", () => {
      const memoizedAdd = memoize4(add);
      memoizedAdd(1, 2, 3, 4);
      memoizedAdd(1, 2, 3, 4);
      memoizedAdd(1, 2, 3, 4);
      memoizedAdd(1, 2, 3, 4);
      expect(effectCheck).toHaveBeenCalledTimes(1);
    });
  });
});
