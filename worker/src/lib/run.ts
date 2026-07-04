import { Cause, Effect, Exit, Option } from "effect";

// Effect.runPromise rejects with a FiberFailure wrapper, which breaks the
// `instanceof` checks route handlers rely on. Run to an Exit and rethrow the
// original typed error instead.
export const runEffect = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);

  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  const failure = Cause.failureOption(exit.cause);

  if (Option.isSome(failure)) {
    throw failure.value;
  }

  throw Cause.squash(exit.cause);
};
