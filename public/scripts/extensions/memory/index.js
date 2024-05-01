import { getStringHash, debounce, waitUntilCondition, extractAllWords } from '../../utils.js';
import { getContext, getApiUrl, extension_settings, doExtrasFetch, modules, renderExtensionTemplateAsync } from '../../extensions.js';
import {
    activateSendButtons,
    deactivateSendButtons,
    animation_duration,
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    generateQuietPrompt,
    is_send_press,
    saveSettingsDebounced,
    substituteParams,
    generateRaw,
    getMaxContextSize,
} from '../../../script.js';
import { is_group_generating, selected_group } from '../../group-chats.js';
import { registerSlashCommand } from '../../slash-commands.js';
import { loadMovingUIState } from '../../power-user.js';
import { dragElement } from '../../RossAscends-mods.js';
import { getTextTokens, getTokenCountAsync, tokenizers } from '../../tokenizers.js';
import { debounce_timeout } from '../../constants.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';
export { MODULE_NAME };

const MODULE_NAME = '1_memory';

let lastCharacterId = null;
let lastGroupId = null;
let lastChatId = null;
let lastMessageHash = null;
let lastMessageId = null;
let inApiCall = false;

const formatMemoryValue = function (value) {
    if (!value) {
        return '';
    }

    value = value.trim();

    if (extension_settings.memory.template) {
        let result = extension_settings.memory.template.replace(/{{summary}}/i, value);
        return substituteParams(result);
    } else {
        return `Summary: ${value}`;
    }
};

const saveChatDebounced = debounce(() => getContext().saveChat(), debounce_timeout.relaxed);

const summary_sources = {
    'extras': 'extras',
    'main': 'main',
};

const prompt_builders = {
    DEFAULT: 0,
    RAW_BLOCKING: 1,
    RAW_NON_BLOCKING: 2,
};

const defaultPrompt = '[Pause your roleplay. Summarize the most important facts and events in the story so far. If a summary already exists in your memory, use that as a base and expand with new facts. Limit the summary to {{words}} words or less. Your response should include nothing but the summary.]';
const defaultTemplate = '[Summary: {{summary}}]';

const defaultSettings = {
    memoryFrozen: false,
    SkipWIAN: false,
    source: summary_sources.extras,
    prompt: defaultPrompt,
    template: defaultTemplate,
    position: extension_prompt_types.IN_PROMPT,
    role: extension_prompt_roles.SYSTEM,
    depth: 2,
    promptWords: 200,
    promptMinWords: 25,
    promptMaxWords: 1000,
    promptWordsStep: 25,
    promptInterval: 10,
    promptMinInterval: 0,
    promptMaxInterval: 250,
    promptIntervalStep: 1,
    promptForceWords: 0,
    promptForceWordsStep: 100,
    promptMinForceWords: 0,
    promptMaxForceWords: 10000,
    overrideResponseLength: 0,
    overrideResponseLengthMin: 0,
    overrideResponseLengthMax: 4096,
    overrideResponseLengthStep: 16,
    maxMessagesPerRequest: 0,
    maxMessagesPerRequestMin: 0,
    maxMessagesPerRequestMax: 250,
    maxMessagesPerRequestStep: 1,
    prompt_builder: prompt_builders.DEFAULT,
};

function loadSettings() {
    if (Object.keys(extension_settings.memory).length === 0) {
        Object.assign(extension_settings.memory, defaultSettings);
    }

    for (const key of Object.keys(defaultSettings)) {
        if (extension_settings.memory[key] === undefined) {
            extension_settings.memory[key] = defaultSettings[key];
        }
    }

    $('#summary_source').val(extension_settings.memory.source).trigger('change');
    $('#memory_frozen').prop('checked', extension_settings.memory.memoryFrozen).trigger('input');
    $('#memory_skipWIAN').prop('checked', extension_settings.memory.SkipWIAN).trigger('input');
    $('#memory_prompt').val(extension_settings.memory.prompt).trigger('input');
    $('#memory_prompt_words').val(extension_settings.memory.promptWords).trigger('input');
    $('#memory_prompt_interval').val(extension_settings.memory.promptInterval).trigger('input');
    $('#memory_template').val(extension_settings.memory.template).trigger('input');
    $('#memory_depth').val(extension_settings.memory.depth).trigger('input');
    $('#memory_role').val(extension_settings.memory.role).trigger('input');
    $(`input[name="memory_position"][value="${extension_settings.memory.position}"]`).prop('checked', true).trigger('input');
    $('#memory_prompt_words_force').val(extension_settings.memory.promptForceWords).trigger('input');
    $(`input[name="memory_prompt_builder"][value="${extension_settings.memory.prompt_builder}"]`).prop('checked', true).trigger('input');
    $('#memory_override_response_length').val(extension_settings.memory.overrideResponseLength).trigger('input');
    $('#memory_max_messages_per_request').val(extension_settings.memory.maxMessagesPerRequest).trigger('input');
    switchSourceControls(extension_settings.memory.source);
}

async function onPromptForceWordsAutoClick() {
    const context = getContext();
    const maxPromptLength = getMaxContextSize(extension_settings.memory.overrideResponseLength);
    const chat = context.chat;
    const allMessages = chat.filter(m => !m.is_system && m.mes).map(m => m.mes);
    const messagesWordCount = allMessages.map(m => extractAllWords(m)).flat().length;
    const averageMessageWordCount = messagesWordCount / allMessages.length;
    const tokensPerWord = await getTokenCountAsync(allMessages.join('\n')) / messagesWordCount;
    const wordsPerToken = 1 / tokensPerWord;
    const maxPromptLengthWords = Math.round(maxPromptLength * wordsPerToken);
    // How many words should pass so that messages will start be dropped out of context;
    const wordsPerPrompt = Math.floor(maxPromptLength / tokensPerWord);
    // How many words will be needed to fit the allowance buffer
    const summaryPromptWords = extractAllWords(extension_settings.memory.prompt).length;
    const promptAllowanceWords = maxPromptLengthWords - extension_settings.memory.promptWords - summaryPromptWords;
    const averageMessagesPerPrompt = Math.floor(promptAllowanceWords / averageMessageWordCount);
    const maxMessagesPerSummary = extension_settings.memory.maxMessagesPerRequest || 0;
    const targetMessagesInPrompt = maxMessagesPerSummary > 0 ? maxMessagesPerSummary : Math.max(0, averageMessagesPerPrompt);
    const targetSummaryWords = (targetMessagesInPrompt * averageMessageWordCount) + (promptAllowanceWords / 4);

    console.table({
        maxPromptLength,
        maxPromptLengthWords,
        promptAllowanceWords,
        averageMessagesPerPrompt,
        targetMessagesInPrompt,
        targetSummaryWords,
        wordsPerPrompt,
        wordsPerToken,
        tokensPerWord,
        messagesWordCount,
    });

    const ROUNDING = 100;
    extension_settings.memory.promptForceWords = Math.max(1, Math.floor(targetSummaryWords / ROUNDING) * ROUNDING);
    $('#memory_prompt_words_force').val(extension_settings.memory.promptForceWords).trigger('input');
}

async function onPromptIntervalAutoClick() {
    const context = getContext();
    const maxPromptLength = getMaxContextSize(extension_settings.memory.overrideResponseLength);
    const chat = context.chat;
    const allMessages = chat.filter(m => !m.is_system && m.mes).map(m => m.mes);
    const messagesWordCount = allMessages.map(m => extractAllWords(m)).flat().length;
    const messagesTokenCount = await getTokenCountAsync(allMessages.join('\n'));
    const tokensPerWord = messagesTokenCount / messagesWordCount;
    const averageMessageTokenCount = messagesTokenCount / allMessages.length;
    const targetSummaryTokens = Math.round(extension_settings.memory.promptWords * tokensPerWord);
    const promptTokens = await getTokenCountAsync(extension_settings.memory.prompt);
    const promptAllowance = maxPromptLength - promptTokens - targetSummaryTokens;
    const maxMessagesPerSummary = extension_settings.memory.maxMessagesPerRequest || 0;
    const averageMessagesPerPrompt = Math.floor(promptAllowance / averageMessageTokenCount);
    const targetMessagesInPrompt = maxMessagesPerSummary > 0 ? maxMessagesPerSummary : Math.max(0, averageMessagesPerPrompt);
    const adjustedAverageMessagesPerPrompt = targetMessagesInPrompt + (averageMessagesPerPrompt - targetMessagesInPrompt) / 4;

    console.table({
        maxPromptLength,
        promptAllowance,
        targetSummaryTokens,
        promptTokens,
        messagesWordCount,
        messagesTokenCount,
        tokensPerWord,
        averageMessageTokenCount,
        averageMessagesPerPrompt,
        targetMessagesInPrompt,
        adjustedAverageMessagesPerPrompt,
        maxMessagesPerSummary,
    });

    const ROUNDING = 5;
    extension_settings.memory.promptInterval = Math.max(1, Math.floor(adjustedAverageMessagesPerPrompt / ROUNDING) * ROUNDING);

    $('#memory_prompt_interval').val(extension_settings.memory.promptInterval).trigger('input');
}

function onSummarySourceChange(event) {
    const value = event.target.value;
    extension_settings.memory.source = value;
    switchSourceControls(value);
    saveSettingsDebounced();
}

function switchSourceControls(value) {
    $('#memory_settings [data-summary-source]').each((_, element) => {
        const source = $(element).data('summary-source');
        $(element).toggle(source === value);
    });
}

function onMemoryFrozenInput() {
    const value = Boolean($(this).prop('checked'));
    extension_settings.memory.memoryFrozen = value;
    saveSettingsDebounced();
}

function onMemorySkipWIANInput() {
    const value = Boolean($(this).prop('checked'));
    extension_settings.memory.SkipWIAN = value;
    saveSettingsDebounced();
}

function onMemoryPromptWordsInput() {
    const value = $(this).val();
    extension_settings.memory.promptWords = Number(value);
    $('#memory_prompt_words_value').text(extension_settings.memory.promptWords);
    saveSettingsDebounced();
}

function onMemoryPromptIntervalInput() {
    const value = $(this).val();
    extension_settings.memory.promptInterval = Number(value);
    $('#memory_prompt_interval_value').text(extension_settings.memory.promptInterval);
    saveSettingsDebounced();
}

function onMemoryPromptRestoreClick() {
    $('#memory_prompt').val(defaultPrompt).trigger('input');
}

function onMemoryPromptInput() {
    const value = $(this).val();
    extension_settings.memory.prompt = value;
    saveSettingsDebounced();
}

function onMemoryTemplateInput() {
    const value = $(this).val();
    extension_settings.memory.template = value;
    reinsertMemory();
    saveSettingsDebounced();
}

function onMemoryDepthInput() {
    const value = $(this).val();
    extension_settings.memory.depth = Number(value);
    reinsertMemory();
    saveSettingsDebounced();
}

function onMemoryRoleInput() {
    const value = $(this).val();
    extension_settings.memory.role = Number(value);
    reinsertMemory();
    saveSettingsDebounced();
}

function onMemoryPositionChange(e) {
    const value = e.target.value;
    extension_settings.memory.position = value;
    reinsertMemory();
    saveSettingsDebounced();
}

function onMemoryPromptWordsForceInput() {
    const value = $(this).val();
    extension_settings.memory.promptForceWords = Number(value);
    $('#memory_prompt_words_force_value').text(extension_settings.memory.promptForceWords);
    saveSettingsDebounced();
}

function onOverrideResponseLengthInput() {
    const value = $(this).val();
    extension_settings.memory.overrideResponseLength = Number(value);
    $('#memory_override_response_length_value').text(extension_settings.memory.overrideResponseLength);
    saveSettingsDebounced();
}

function onMaxMessagesPerRequestInput() {
    const value = $(this).val();
    extension_settings.memory.maxMessagesPerRequest = Number(value);
    $('#memory_max_messages_per_request_value').text(extension_settings.memory.maxMessagesPerRequest);
    saveSettingsDebounced();
}

function saveLastValues() {
    const context = getContext();
    lastGroupId = context.groupId;
    lastCharacterId = context.characterId;
    lastChatId = context.chatId;
    lastMessageId = context.chat?.length ?? null;
    lastMessageHash = getStringHash((context.chat.length && context.chat[context.chat.length - 1]['mes']) ?? '');
}

function getLatestMemoryFromChat(chat) {
    if (!Array.isArray(chat) || !chat.length) {
        return '';
    }

    const reversedChat = chat.slice().reverse();
    reversedChat.shift();
    for (let mes of reversedChat) {
        if (mes.extra && mes.extra.memory) {
            return mes.extra.memory;
        }
    }

    return '';
}

function getIndexOfLatestChatSummary(chat) {
    if (!Array.isArray(chat) || !chat.length) {
        return -1;
    }

    const reversedChat = chat.slice().reverse();
    reversedChat.shift();
    for (let mes of reversedChat) {
        if (mes.extra && mes.extra.memory) {
            return chat.indexOf(mes);
        }
    }

    return -1;
}

async function onChatEvent() {
    // Module not enabled
    if (extension_settings.memory.source === summary_sources.extras) {
        if (!modules.includes('summarize')) {
            return;
        }
    }

    const context = getContext();
    const chat = context.chat;

    // no characters or group selected
    if (!context.groupId && context.characterId === undefined) {
        return;
    }

    // Generation is in progress, summary prevented
    if (is_send_press) {
        return;
    }

    // Chat/character/group changed
    if ((context.groupId && lastGroupId !== context.groupId) || (context.characterId !== lastCharacterId) || (context.chatId !== lastChatId)) {
        const latestMemory = getLatestMemoryFromChat(chat);
        setMemoryContext(latestMemory, false);
        saveLastValues();
        return;
    }

    // Currently summarizing or frozen state - skip
    if (inApiCall || extension_settings.memory.memoryFrozen) {
        return;
    }

    // No new messages - do nothing
    if (chat.length === 0 || (lastMessageId === chat.length && getStringHash(chat[chat.length - 1].mes) === lastMessageHash)) {
        return;
    }

    // Messages has been deleted - rewrite the context with the latest available memory
    if (chat.length < lastMessageId) {
        const latestMemory = getLatestMemoryFromChat(chat);
        setMemoryContext(latestMemory, false);
    }

    // Message has been edited / regenerated - delete the saved memory
    if (chat.length
        && chat[chat.length - 1].extra
        && chat[chat.length - 1].extra.memory
        && lastMessageId === chat.length
        && getStringHash(chat[chat.length - 1].mes) !== lastMessageHash) {
        delete chat[chat.length - 1].extra.memory;
    }

    try {
        await summarizeChat(context);
    }
    catch (error) {
        console.log(error);
    }
    finally {
        saveLastValues();
    }
}

async function forceSummarizeChat() {
    if (extension_settings.memory.source === summary_sources.extras) {
        toastr.warning('Force summarization is not supported for Extras API');
        return;
    }

    const context = getContext();

    const skipWIAN = extension_settings.memory.SkipWIAN;
    console.log(`Skipping WIAN? ${skipWIAN}`);
    if (!context.chatId) {
        toastr.warning('No chat selected');
        return;
    }

    toastr.info('Summarizing chat...', 'Please wait');
    const value = await summarizeChatMain(context, true, skipWIAN);

    if (!value) {
        toastr.warning('Failed to summarize chat');
        return;
    }
}

async function summarizeChat(context) {
    const skipWIAN = extension_settings.memory.SkipWIAN;
    switch (extension_settings.memory.source) {
        case summary_sources.extras:
            await summarizeChatExtras(context);
            break;
        case summary_sources.main:
            await summarizeChatMain(context, false, skipWIAN);
            break;
        default:
            break;
    }
}

async function summarizeChatMain(context, force, skipWIAN) {

    if (extension_settings.memory.promptInterval === 0 && !force) {
        console.debug('Prompt interval is set to 0, skipping summarization');
        return;
    }

    try {
        // Wait for group to finish generating
        if (selected_group) {
            await waitUntilCondition(() => is_group_generating === false, 1000, 10);
        }
        // Wait for the send button to be released
        waitUntilCondition(() => is_send_press === false, 30000, 100);
    } catch {
        console.debug('Timeout waiting for is_send_press');
        return;
    }

    if (!context.chat.length) {
        console.debug('No messages in chat to summarize');
        return;
    }

    if (context.chat.length < extension_settings.memory.promptInterval && !force) {
        console.debug(`Not enough messages in chat to summarize (chat: ${context.chat.length}, interval: ${extension_settings.memory.promptInterval})`);
        return;
    }

    let messagesSinceLastSummary = 0;
    let wordsSinceLastSummary = 0;
    let conditionSatisfied = false;
    for (let i = context.chat.length - 1; i >= 0; i--) {
        if (context.chat[i].extra && context.chat[i].extra.memory) {
            break;
        }
        messagesSinceLastSummary++;
        wordsSinceLastSummary += extractAllWords(context.chat[i].mes).length;
    }

    if (messagesSinceLastSummary >= extension_settings.memory.promptInterval) {
        conditionSatisfied = true;
    }

    if (extension_settings.memory.promptForceWords && wordsSinceLastSummary >= extension_settings.memory.promptForceWords) {
        conditionSatisfied = true;
    }

    if (!conditionSatisfied && !force) {
        console.debug(`Summary conditions not satisfied (messages: ${messagesSinceLastSummary}, interval: ${extension_settings.memory.promptInterval}, words: ${wordsSinceLastSummary}, force words: ${extension_settings.memory.promptForceWords})`);
        return;
    }

    console.log('Summarizing chat, messages since last summary: ' + messagesSinceLastSummary, 'words since last summary: ' + wordsSinceLastSummary);
    const prompt = extension_settings.memory.prompt?.replace(/{{words}}/gi, extension_settings.memory.promptWords);

    if (!prompt) {
        console.debug('Summarization prompt is empty. Skipping summarization.');
        return;
    }

    console.log('sending summary prompt');
    let summary = '';
    let index = null;

    if (prompt_builders.DEFAULT === extension_settings.memory.prompt_builder) {
        summary = await generateQuietPrompt(prompt, false, skipWIAN, '', '', extension_settings.memory.overrideResponseLength);
    }

    if ([prompt_builders.RAW_BLOCKING, prompt_builders.RAW_NON_BLOCKING].includes(extension_settings.memory.prompt_builder)) {
        const lock = extension_settings.memory.prompt_builder === prompt_builders.RAW_BLOCKING;
        try {
            if (lock) {
                deactivateSendButtons();
            }

            const { rawPrompt, lastUsedIndex } = await getRawSummaryPrompt(context, prompt);

            if (lastUsedIndex === null || lastUsedIndex === -1) {
                if (force) {
                    toastr.info('To try again, remove the latest summary.', 'No messages found to summarize');
                }

                return null;
            }

            summary = await generateRaw(rawPrompt, '', false, false, prompt, extension_settings.memory.overrideResponseLength);
            index = lastUsedIndex;
        } finally {
            if (lock) {
                activateSendButtons();
            }
        }
    }

    const newContext = getContext();

    // something changed during summarization request
    if (newContext.groupId !== context.groupId
        || newContext.chatId !== context.chatId
        || (!newContext.groupId && (newContext.characterId !== context.characterId))) {
        console.log('Context changed, summary discarded');
        return;
    }

    setMemoryContext(summary, true, index);
    return summary;
}

/**
 * Get the raw summarization prompt from the chat context.
 * @param {object} context ST context
 * @param {string} prompt Summarization system prompt
 * @returns {Promise<{rawPrompt: string, lastUsedIndex: number}>} Raw summarization prompt
 */
async function getRawSummaryPrompt(context, prompt) {
    /**
     * Get the memory string from the chat buffer.
     * @param {boolean} includeSystem Include prompt into the memory string
     * @returns {string} Memory string
     */
    function getMemoryString(includeSystem) {
        const delimiter = '\n\n';
        const stringBuilder = [];
        const bufferString = chatBuffer.slice().join(delimiter);

        if (includeSystem) {
            stringBuilder.push(prompt);
        }

        if (latestSummary) {
            stringBuilder.push(latestSummary);
        }

        stringBuilder.push(bufferString);

        return stringBuilder.join(delimiter).trim();
    }

    const chat = context.chat.slice();
    const latestSummary = getLatestMemoryFromChat(chat);
    const latestSummaryIndex = getIndexOfLatestChatSummary(chat);
    chat.pop(); // We always exclude the last message from the buffer
    const chatBuffer = [];
    const PADDING = 64;
    const PROMPT_SIZE = getMaxContextSize(extension_settings.memory.overrideResponseLength);
    let latestUsedMessage = null;

    for (let index = latestSummaryIndex + 1; index < chat.length; index++) {
        const message = chat[index];

        if (!message) {
            break;
        }

        if (message.is_system || !message.mes) {
            continue;
        }

        const entry = `${message.name}:\n${message.mes}`;
        chatBuffer.push(entry);

        const tokens = await getTokenCountAsync(getMemoryString(true), PADDING);

        if (tokens > PROMPT_SIZE) {
            chatBuffer.pop();
            break;
        }

        latestUsedMessage = message;

        if (extension_settings.memory.maxMessagesPerRequest > 0 && chatBuffer.length >= extension_settings.memory.maxMessagesPerRequest) {
            break;
        }
    }

    const lastUsedIndex = context.chat.indexOf(latestUsedMessage);
    const rawPrompt = getMemoryString(false);
    return { rawPrompt, lastUsedIndex };
}

async function summarizeChatExtras(context) {
    function getMemoryString() {
        return (longMemory + '\n\n' + memoryBuffer.slice().reverse().join('\n\n')).trim();
    }

    const chat = context.chat;
    const longMemory = getLatestMemoryFromChat(chat);
    const reversedChat = chat.slice().reverse();
    reversedChat.shift();
    const memoryBuffer = [];
    const CONTEXT_SIZE = 1024 - 64;

    for (const message of reversedChat) {
        // we reached the point of latest memory
        if (longMemory && message.extra && message.extra.memory == longMemory) {
            break;
        }

        // don't care about system
        if (message.is_system) {
            continue;
        }

        // determine the sender's name
        const entry = `${message.name}:\n${message.mes}`;
        memoryBuffer.push(entry);

        // check if token limit was reached
        const tokens = getTextTokens(tokenizers.GPT2, getMemoryString()).length;
        if (tokens >= CONTEXT_SIZE) {
            break;
        }
    }

    const resultingString = getMemoryString();
    const resultingTokens = getTextTokens(tokenizers.GPT2, resultingString).length;

    if (!resultingString || resultingTokens < CONTEXT_SIZE) {
        console.debug('Not enough context to summarize');
        return;
    }

    // perform the summarization API call
    try {
        inApiCall = true;
        const url = new URL(getApiUrl());
        url.pathname = '/api/summarize';

        const apiResult = await doExtrasFetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Bypass-Tunnel-Reminder': 'bypass',
            },
            body: JSON.stringify({
                text: resultingString,
                params: {},
            }),
        });

        if (apiResult.ok) {
            const data = await apiResult.json();
            const summary = data.summary;

            const newContext = getContext();

            // something changed during summarization request
            if (newContext.groupId !== context.groupId
                || newContext.chatId !== context.chatId
                || (!newContext.groupId && (newContext.characterId !== context.characterId))) {
                console.log('Context changed, summary discarded');
                return;
            }

            setMemoryContext(summary, true);
        }
    }
    catch (error) {
        console.log(error);
    }
    finally {
        inApiCall = false;
    }
}

function onMemoryRestoreClick() {
    const context = getContext();
    const content = $('#memory_contents').val();
    const reversedChat = context.chat.slice().reverse();
    reversedChat.shift();

    for (let mes of reversedChat) {
        if (mes.extra && mes.extra.memory == content) {
            delete mes.extra.memory;
            break;
        }
    }

    const newContent = getLatestMemoryFromChat(context.chat);
    setMemoryContext(newContent, false);
}

function onMemoryContentInput() {
    const value = $(this).val();
    setMemoryContext(value, true);
}

function onMemoryPromptBuilderInput(e) {
    const value = Number(e.target.value);
    extension_settings.memory.prompt_builder = value;
    saveSettingsDebounced();
}

function reinsertMemory() {
    const existingValue = String($('#memory_contents').val());
    setMemoryContext(existingValue, false);
}

/**
 * Set the summary value to the context and save it to the chat message extra.
 * @param {string} value Value of a summary
 * @param {boolean} saveToMessage Should the summary be saved to the chat message extra
 * @param {number|null} index Index of the chat message to save the summary to. If null, the pre-last message is used.
 */
function setMemoryContext(value, saveToMessage, index = null) {
    const context = getContext();
    context.setExtensionPrompt(MODULE_NAME, formatMemoryValue(value), extension_settings.memory.position, extension_settings.memory.depth, false, extension_settings.memory.role);
    $('#memory_contents').val(value);
    console.log('Summary set to: ' + value);
    console.debug('Position: ' + extension_settings.memory.position);
    console.debug('Depth: ' + extension_settings.memory.depth);
    console.debug('Role: ' + extension_settings.memory.role);

    if (saveToMessage && context.chat.length) {
        const idx = index ?? context.chat.length - 2;
        const mes = context.chat[idx < 0 ? 0 : idx];

        if (!mes.extra) {
            mes.extra = {};
        }

        mes.extra.memory = value;
        saveChatDebounced();
    }
}

function doPopout(e) {
    const target = e.target;
    //repurposes the zoomed avatar template to server as a floating div
    if ($('#summaryExtensionPopout').length === 0) {
        console.debug('did not see popout yet, creating');
        const originalHTMLClone = $(target).parent().parent().parent().find('.inline-drawer-content').html();
        const originalElement = $(target).parent().parent().parent().find('.inline-drawer-content');
        const template = $('#zoomed_avatar_template').html();
        const controlBarHtml = `<div class="panelControlBar flex-container">
        <div id="summaryExtensionPopoutheader" class="fa-solid fa-grip drag-grabber hoverglow"></div>
        <div id="summaryExtensionPopoutClose" class="fa-solid fa-circle-xmark hoverglow dragClose"></div>
    </div>`;
        const newElement = $(template);
        newElement.attr('id', 'summaryExtensionPopout')
            .removeClass('zoomed_avatar')
            .addClass('draggable')
            .empty();
        const prevSummaryBoxContents = $('#memory_contents').val(); //copy summary box before emptying
        originalElement.empty();
        originalElement.html('<div class="flex-container alignitemscenter justifyCenter wide100p"><small>Currently popped out</small></div>');
        newElement.append(controlBarHtml).append(originalHTMLClone);
        $('body').append(newElement);
        $('#summaryExtensionDrawerContents').addClass('scrollableInnerFull');
        setMemoryContext(prevSummaryBoxContents, false); //paste prev summary box contents into popout box
        setupListeners();
        loadSettings();
        loadMovingUIState();

        $('#summaryExtensionPopout').fadeIn(animation_duration);
        dragElement(newElement);

        //setup listener for close button to restore extensions menu
        $('#summaryExtensionPopoutClose').off('click').on('click', function () {
            $('#summaryExtensionDrawerContents').removeClass('scrollableInnerFull');
            const summaryPopoutHTML = $('#summaryExtensionDrawerContents');
            $('#summaryExtensionPopout').fadeOut(animation_duration, () => {
                originalElement.empty();
                originalElement.html(summaryPopoutHTML);
                $('#summaryExtensionPopout').remove();
            });
            loadSettings();
        });
    } else {
        console.debug('saw existing popout, removing');
        $('#summaryExtensionPopout').fadeOut(animation_duration, () => { $('#summaryExtensionPopoutClose').trigger('click'); });
    }
}

function setupListeners() {
    //setup shared listeners for popout and regular ext menu
    $('#memory_restore').off('click').on('click', onMemoryRestoreClick);
    $('#memory_contents').off('click').on('input', onMemoryContentInput);
    $('#memory_frozen').off('click').on('input', onMemoryFrozenInput);
    $('#memory_skipWIAN').off('click').on('input', onMemorySkipWIANInput);
    $('#summary_source').off('click').on('change', onSummarySourceChange);
    $('#memory_prompt_words').off('click').on('input', onMemoryPromptWordsInput);
    $('#memory_prompt_interval').off('click').on('input', onMemoryPromptIntervalInput);
    $('#memory_prompt').off('click').on('input', onMemoryPromptInput);
    $('#memory_force_summarize').off('click').on('click', forceSummarizeChat);
    $('#memory_template').off('click').on('input', onMemoryTemplateInput);
    $('#memory_depth').off('click').on('input', onMemoryDepthInput);
    $('#memory_role').off('click').on('input', onMemoryRoleInput);
    $('input[name="memory_position"]').off('click').on('change', onMemoryPositionChange);
    $('#memory_prompt_words_force').off('click').on('input', onMemoryPromptWordsForceInput);
    $('#memory_prompt_builder_default').off('click').on('input', onMemoryPromptBuilderInput);
    $('#memory_prompt_builder_raw_blocking').off('click').on('input', onMemoryPromptBuilderInput);
    $('#memory_prompt_builder_raw_non_blocking').off('click').on('input', onMemoryPromptBuilderInput);
    $('#memory_prompt_restore').off('click').on('click', onMemoryPromptRestoreClick);
    $('#memory_prompt_interval_auto').off('click').on('click', onPromptIntervalAutoClick);
    $('#memory_prompt_words_auto').off('click').on('click', onPromptForceWordsAutoClick);
    $('#memory_override_response_length').off('click').on('input', onOverrideResponseLengthInput);
    $('#memory_max_messages_per_request').off('click').on('input', onMaxMessagesPerRequestInput);
    $('#summarySettingsBlockToggle').off('click').on('click', function () {
        console.log('saw settings button click');
        $('#summarySettingsBlock').slideToggle(200, 'swing'); //toggleClass("hidden");
    });
}

jQuery(async function () {
    async function addExtensionControls() {
        const settingsHtml = await renderExtensionTemplateAsync('memory', 'settings', { defaultSettings });
        $('#extensions_settings2').append(settingsHtml);
        setupListeners();
        $('#summaryExtensionPopoutButton').off('click').on('click', function (e) {
            doPopout(e);
            e.stopPropagation();
        });
    }

    await addExtensionControls();
    loadSettings();
    eventSource.on(event_types.MESSAGE_RECEIVED, onChatEvent);
    eventSource.on(event_types.MESSAGE_DELETED, onChatEvent);
    eventSource.on(event_types.MESSAGE_EDITED, onChatEvent);
    eventSource.on(event_types.MESSAGE_SWIPED, onChatEvent);
    eventSource.on(event_types.CHAT_CHANGED, onChatEvent);
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'summarize',
        callback: forceSummarizeChat,
        helpString: 'Forces the summarization of the current chat using the Main API.',
        interruptsGeneration: true,
        purgeFromMessage: true,
    }));
});
