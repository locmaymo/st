export class SlashCommandClosureResult {
    /**@type {boolean}*/ interrupt = false;
    /**@type {string}*/ newText = '';
    /**@type {string}*/ pipe;
    /**@type {boolean}*/ isAborted = false;
    /**@type {string}*/ abortReason;
    /**@type {boolean}*/ isError = false;
    /**@type {string}*/ errorMessage;
}
