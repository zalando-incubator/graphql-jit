import { zip } from "lodash";

declare module "lodash" {
  interface LodashStatic {
    zip<T>(...arrays: Array<Array<T>>): Array<Array<T>>;
  }
}
