import type { ApiResponse, StudyApi } from '../shared/types';

declare global {
  interface Window {
    studyApi: { call(method: string, args: unknown[]): Promise<ApiResponse<unknown>> };
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public userError: boolean,
  ) {
    super(message);
  }
}

type Async<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<R> : never };

/** Typed client for the data layer running in the main process. */
export const api = new Proxy({} as Async<StudyApi>, {
  get(_target, method: string) {
    return async (...args: unknown[]) => {
      const res = await window.studyApi.call(method, args);
      if (!res.ok) throw new ApiError(res.error, res.userError);
      return res.value;
    };
  },
});
