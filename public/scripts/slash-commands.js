import {
    Generate,
    activateSendButtons,
    addOneMessage,
    callPopup,
    characters,
    chat,
    chat_metadata,
    comment_avatar,
    deactivateSendButtons,
    default_avatar,
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    extractMessageBias,
    generateQuietPrompt,
    generateRaw,
    getThumbnailUrl,
    is_send_press,
    main_api,
    name1,
    name2,
    reloadCurrentChat,
    removeMacros,
    retriggerFirstMessageOnEmptyChat,
    saveChatConditional,
    sendMessageAsUser,
    sendSystemMessage,
    setActiveCharacter,
    setActiveGroup,
    setCharacterId,
    setCharacterName,
    setExtensionPrompt,
    setUserName,
    substituteParams,
    system_avatar,
    system_message_types,
    this_chid,
} from '../script.js';
import { PARSER_FLAG, SlashCommandParser } from './slash-commands/SlashCommandParser.js';
import { SlashCommandParserError } from './slash-commands/SlashCommandParserError.js';
import { getMessageTimeStamp } from './RossAscends-mods.js';
import { hideChatMessageRange } from './chats.js';
import { getContext, saveMetadataDebounced } from './extensions.js';
import { getRegexedString, regex_placement } from './extensions/regex/engine.js';
import { findGroupMemberId, groups, is_group_generating, openGroupById, resetSelectedGroup, saveGroupChat, selected_group } from './group-chats.js';
import { chat_completion_sources, oai_settings } from './openai.js';
import { autoSelectPersona } from './personas.js';
import { addEphemeralStoppingString, chat_styles, flushEphemeralStoppingStrings, power_user } from './power-user.js';
import { textgen_types, textgenerationwebui_settings } from './textgen-settings.js';
import { decodeTextTokens, getFriendlyTokenizerName, getTextTokens, getTokenCountAsync } from './tokenizers.js';
import { debounce, delay, isFalseBoolean, isTrueBoolean, stringToRange, trimToEndSentence, trimToStartSentence, waitUntilCondition } from './utils.js';
import { registerVariableCommands, resolveVariable } from './variables.js';
import { background_settings } from './backgrounds.js';
import { SlashCommandScope } from './slash-commands/SlashCommandScope.js';
import { SlashCommandClosure } from './slash-commands/SlashCommandClosure.js';
import { SlashCommandClosureResult } from './slash-commands/SlashCommandClosureResult.js';
import { AutoCompleteNameResult } from './autocomplete/AutoCompleteNameResult.js';
import { AutoCompleteOption } from './autocomplete/AutoCompleteOption.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from './slash-commands/SlashCommandArgument.js';
import { AutoComplete } from './autocomplete/AutoComplete.js';
import { SlashCommand } from './slash-commands/SlashCommand.js';
import { SlashCommandAbortController } from './slash-commands/SlashCommandAbortController.js';
export {
    executeSlashCommands, executeSlashCommandsWithOptions, getSlashCommandsHelp, registerSlashCommand,
};

export const parser = new SlashCommandParser();
/**
 * @deprecated Use SlashCommandParser.addCommandObject() instead
 */
const registerSlashCommand = SlashCommandParser.addCommand.bind(SlashCommandParser);
const getSlashCommandsHelp = parser.getHelpString.bind(parser);

SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: '?',
    callback: helpCommandCallback,
    aliases: ['help'],
    unnamedArgumentList: [new SlashCommandArgument(
        'help topic', ARGUMENT_TYPE.STRING, false, false, null, ['slash', 'format', 'hotkeys', 'macros'],
    )],
    helpString: 'Get help on macros, chat formatting and commands.',
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'name',
    callback: setNameCallback,
    unnamedArgumentList: [
        new SlashCommandArgument(
            'persona', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: 'Sets user name and persona avatar (if set).',
    aliases: ['persona'],
    interruptsGeneration: true,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'sync',
    callback: syncCallback,
    helpString: 'Syncs the user persona in user-attributed messages in the current chat.',
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'lock',
    callback: bindCallback,
    aliases: ['bind'],
    helpString: 'Locks/unlocks a persona (name and avatar) to the current chat',
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'bg',
    callback: setBackgroundCallback,
    aliases: ['background'],
    returns: 'the current background',
    unnamedArgumentList: [
        new SlashCommandArgument(
            'filename', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: `
        <div>
            Sets a background according to the provided filename. Partial names allowed.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/bg beach.jpg</code></pre>
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'sendas',
    callback: sendMessageAs,
    namedArgumentList: [
        new SlashCommandNamedArgument(
            'name', 'Character name', [ARGUMENT_TYPE.STRING], true,
        ),
        new SlashCommandNamedArgument(
            'compact', 'Use compact layout', [ARGUMENT_TYPE.BOOLEAN], false, false, 'false', ['true', 'false'],
        ),
    ],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: `
        <div>
            Sends a message as a specific character. Uses the character avatar if it exists in the characters list.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/sendas name="Chloe" Hello, guys!</code></pre>
                    will send "Hello, guys!" from "Chloe".
                </li>
            </ul>
        </div>
        <div>
            If "compact" is set to true, the message is sent using a compact layout.
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'sys',
    callback: sendNarratorMessage,
    aliases: ['nar'],
    namedArgumentList: [
        new SlashCommandNamedArgument(
            'compact',
            'compact layout',
            [ARGUMENT_TYPE.BOOLEAN],
            false,
            false,
            'false',
        ),
    ],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: `
        <div>
            Sends a message as a system narrator.
        </div>
        <div>
            If <code>compact</code> is set to <code>true</code>, the message is sent using a compact layout.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/sys The sun sets in the west.</code></pre>
                </li>
                <li>
                    <pre><code>/sys compact=true A brief note.</code></pre>
                </li>
            </ul>
        </div>
    `,
    interruptsGeneration: false,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'sysname',
    callback: setNarratorName,
    unnamedArgumentList: [
        new SlashCommandArgument(
            'name', [ARGUMENT_TYPE.STRING], false,
        ),
    ],
    helpString: 'Sets a name for future system narrator messages in this chat (display only). Default: System. Leave empty to reset.',
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'comment',
    callback: sendCommentMessage,
    namedArgumentList: [
        new SlashCommandNamedArgument(
            'compact',
            'Whether to use a compact layout',
            [ARGUMENT_TYPE.BOOLEAN],
            false,
            false,
            'false',
        ),
    ],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text',
            [ARGUMENT_TYPE.STRING],
            true,
        ),
    ],
    helpString: `
        <div>
            Adds a note/comment message not part of the chat.
        </div>
        <div>
            If <code>compact</code> is set to <code>true</code>, the message is sent using a compact layout.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/comment This is a comment</code></pre>
                </li>
                <li>
                    <pre><code>/comment compact=true This is a compact comment</code></pre>
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'single',
    callback: setStoryModeCallback,
    aliases: ['story'],
    helpString: 'Sets the message style to single document mode without names or avatars visible.',
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'bubble',
    callback: setBubbleModeCallback,
    aliases: ['bubbles'],
    helpString: 'Sets the message style to bubble chat mode.',
    interruptsGeneration: true,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'flat',
    callback: setFlatModeCallback,
    aliases: ['default'],
    helpString: 'Sets the message style to flat chat mode.',
    interruptsGeneration: true,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'continue',
    callback: continueChatCallback,
    aliases: ['cont'],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'prompt', [ARGUMENT_TYPE.STRING], false,
        ),
    ],
    helpString: `
        <div>
            Continues the last message in the chat, with an optional additional prompt.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/continue</code></pre>
                    Continues the chat with no additional prompt.
                </li>
                <li>
                    <pre><code>/continue Let's explore this further...</code></pre>
                    Continues the chat with the provided prompt.
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'go',
    callback: goToCharacterCallback,
    unnamedArgumentList: [
        new SlashCommandArgument(
            'name', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: 'Opens up a chat with the character or group by its name',
    aliases: ['char'],
    interruptsGeneration: true,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'sysgen',
    callback: generateSystemMessage,
    unnamedArgumentList: [
        new SlashCommandArgument(
            'prompt', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: 'Generates a system message using a specified prompt.',
    interruptsGeneration: true,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'ask',
    callback: askCharacter,
    unnamedArgumentList: [
        new SlashCommandArgument(
            'character name', [ARGUMENT_TYPE.STRING], true,
        ),
        new SlashCommandArgument(
            'prompt', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: 'Asks a specified character card a prompt. Character name and prompt have to be separated by a new line.',
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'delname',
    callback: deleteMessagesByNameCallback,
    namedArgumentList: [],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'name', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    aliases: ['cancel'],
    helpString: `
        <div>
            Deletes all messages attributed to a specified name.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/delname John</code></pre>
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'send',
    callback: sendUserMessageCallback,
    namedArgumentList: [
        new SlashCommandNamedArgument(
            'compact',
            'whether to use a compact layout',
            [ARGUMENT_TYPE.BOOLEAN],
            false,
            false,
            'false',
        ),
    ],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text',
            [ARGUMENT_TYPE.STRING],
            true,
        ),
    ],
    helpString: `
        <div>
            Adds a user message to the chat log without triggering a generation.
        </div>
        <div>
            If <code>compact</code> is set to <code>true</code>, the message is sent using a compact layout.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/send Hello there!</code></pre>
                </li>
                <li>
                    <pre><code>/send compact=true Hi</code></pre>
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'trigger',
    callback: triggerGenerationCallback,
    namedArgumentList: [
        new SlashCommandNamedArgument(
            'await',
            'Whether to await for the triggered generation before continuing',
            [ARGUMENT_TYPE.BOOLEAN],
            false,
            false,
            'false',
        ),
    ],
    helpString: `
        <div>
            Triggers a message generation. If in group, can trigger a message for the specified group member index or name.
        </div>
        <div>
            If <code>await=true</code> named argument is passed, the command will await for the triggered generation before continuing.
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'hide',
    callback: hideMessageCallback,
    unnamedArgumentList: [
        new SlashCommandArgument(
            'message index or range', [ARGUMENT_TYPE.NUMBER, ARGUMENT_TYPE.RANGE], true,
        ),
    ],
    helpString: 'Hides a chat message from the prompt.',
    interruptsGeneration: true,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'unhide',
    callback: unhideMessageCallback,
    unnamedArgumentList: [
        new SlashCommandArgument(
            'message index or range', [ARGUMENT_TYPE.NUMBER, ARGUMENT_TYPE.RANGE], true,
        ),
    ],
    helpString: 'Unhides a message from the prompt.',
    interruptsGeneration: true,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'disable',
    callback: disableGroupMemberCallback,
    unnamedArgumentList: [
        new SlashCommandArgument(
            'member index or name', [ARGUMENT_TYPE.NUMBER, ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: 'Disables a group member from being drafted for replies.',
    interruptsGeneration: true,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'enable',
    callback: enableGroupMemberCallback,
    unnamedArgumentList: [
        new SlashCommandArgument(
            'member index or name', [ARGUMENT_TYPE.NUMBER, ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: 'Enables a group member to be drafted for replies.',
    interruptsGeneration: true,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'memberadd',
    callback: addGroupMemberCallback,
    aliases: ['addmember'],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'character name', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: `
        <div>
            Adds a new group member to the group chat.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/memberadd John Doe</code></pre>
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'memberremove',
    callback: removeGroupMemberCallback,
    aliases: ['removemember'],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'member index or name', [ARGUMENT_TYPE.NUMBER, ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: `
        <div>
            Removes a group member from the group chat.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/memberremove 2</code></pre>
                    <pre><code>/memberremove John Doe</code></pre>
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'memberup',
    callback: moveGroupMemberUpCallback,
    aliases: ['upmember'],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'member index or name', [ARGUMENT_TYPE.NUMBER, ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: 'Moves a group member up in the group chat list.',
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'memberdown',
    callback: moveGroupMemberDownCallback,
    aliases: ['downmember'],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'member index or name', [ARGUMENT_TYPE.NUMBER, ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: 'Moves a group member down in the group chat list.',
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'peek',
    callback: peekCallback,
    unnamedArgumentList: [
        new SlashCommandArgument(
            'message index or range', [ARGUMENT_TYPE.NUMBER, ARGUMENT_TYPE.RANGE], false, true,
        ),
    ],
    helpString: `
        <div>
            Shows a group member character card without switching chats.
        </div>
        <div>
            <strong>Examples:</strong>
            <ul>
                <li>
                    <pre><code>/peek 5</code></pre>
                    Shows the character card for the 5th message.
                </li>
                <li>
                    <pre><code>/peek 2-5</code></pre>
                    Shows the character cards for messages 2 through 5.
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'delswipe',
    callback: deleteSwipeCallback,
    aliases: ['swipedel'],
    unnamedArgumentList: [
        new SlashCommandArgument(
            '1-based swipe id', [ARGUMENT_TYPE.NUMBER],
        ),
    ],
    helpString: `
        <div>
            Deletes a swipe from the last chat message. If swipe id is not provided, it deletes the current swipe.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/delswipe</code></pre>
                    Deletes the current swipe.
                </li>
                <li>
                    <pre><code>/delswipe 2</code></pre>
                    Deletes the second swipe from the last chat message.
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'echo',
    callback: echoCallback,
    returns: 'the text',
    namedArgumentList: [
        new SlashCommandNamedArgument(
            'title', 'title of the toast message', [ARGUMENT_TYPE.STRING], false,
        ),
        new SlashCommandNamedArgument(
            'severity', 'severity level of the toast message', [ARGUMENT_TYPE.STRING], false, false, null, ['info', 'warning', 'error', 'success'],
        ),
    ],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: `
        <div>
            Echoes the provided text to a toast message. Useful for pipes debugging.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/echo title="My Message" severity=info This is an info message</code></pre>
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'gen',
    callback: generateCallback,
    returns: 'generated text',
    namedArgumentList: [
        new SlashCommandNamedArgument(
            'lock', 'lock user input during generation', [ARGUMENT_TYPE.BOOLEAN], false, false, null, ['on', 'off'],
        ),
        new SlashCommandNamedArgument(
            'name', 'in-prompt name for instruct mode', [ARGUMENT_TYPE.STRING], false, false, 'System',
        ),
        new SlashCommandNamedArgument(
            'length', 'API response length in tokens', [ARGUMENT_TYPE.NUMBER], false,
        ),
        new SlashCommandNamedArgument(
            'as', 'role of the output prompt', [ARGUMENT_TYPE.STRING], false, false, 'system', ['system', 'char'],
        ),
    ],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'prompt', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: `
        <div>
            Generates text using the provided prompt and passes it to the next command through the pipe, optionally locking user input while generating and allowing to configure the in-prompt name for instruct mode (default = "System").
        </div>
        <div>
            "as" argument controls the role of the output prompt: system (default) or char. If "length" argument is provided as a number in tokens, allows to temporarily override an API response length.
        </div>
    `,
    interruptsGeneration: true,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'genraw',
    callback: generateRawCallback,
    returns: 'generated text',
    namedArgumentList: [
        new SlashCommandNamedArgument(
            'lock', 'lock user input during generation', [ARGUMENT_TYPE.BOOLEAN], false, false, null, ['on', 'off'],
        ),
        new SlashCommandNamedArgument(
            'instruct', 'use instruct mode', [ARGUMENT_TYPE.BOOLEAN], false, false, 'on', ['on', 'off'],
        ),
        new SlashCommandNamedArgument(
            'stop', 'one-time custom stop strings', [ARGUMENT_TYPE.LIST], false,
        ),
        new SlashCommandNamedArgument(
            'as', 'role of the output prompt', [ARGUMENT_TYPE.STRING], false, false, 'system', ['system', 'char'],
        ),
        new SlashCommandNamedArgument(
            'system', 'system prompt at the start', [ARGUMENT_TYPE.STRING], false,
        ),
        new SlashCommandNamedArgument(
            'length', 'API response length in tokens', [ARGUMENT_TYPE.NUMBER], false,
        ),
    ],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'prompt', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: `
        <div>
            Generates text using the provided prompt and passes it to the next command through the pipe, optionally locking user input while generating. Does not include chat history or character card.
        </div>
        <div>
            Use instruct=off to skip instruct formatting, e.g. <pre><code>/genraw instruct=off Why is the sky blue?</code></pre>
        </div>
        <div>
            Use stop=... with a JSON-serialized array to add one-time custom stop strings, e.g. <pre><code>/genraw stop=["\\n"] Say hi</code></pre>
        </div>
        <div>
            "as" argument controls the role of the output prompt: system (default) or char. "system" argument adds an (optional) system prompt at the start.
        </div>
        <div>
            If "length" argument is provided as a number in tokens, allows to temporarily override an API response length.
        </div>
    `,
    interruptsGeneration: true,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'addswipe',
    callback: addSwipeCallback,
    aliases: ['swipeadd'],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: 'Adds a swipe to the last chat message.',
    interruptsGeneration: true,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'abort',
    callback: abortCallback,
    helpString: 'Aborts the slash command batch execution.',
    interruptsGeneration: true,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'fuzzy',
    callback: fuzzyCallback,
    returns: 'first matching item',
    namedArgumentList: [
        new SlashCommandNamedArgument(
            'list', 'list of items to match against', [ARGUMENT_TYPE.LIST], true,
        ),
        new SlashCommandNamedArgument(
            'threshold', 'fuzzy match threshold (0.0 to 1.0)', [ARGUMENT_TYPE.NUMBER], false, false, '0.4',
        ),
    ],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text to search', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: `
        <div>
            Performs a fuzzy match of each item in the <code>list</code> against the <code>text to search</code>.
            If any item matches, then its name is returned. If no item matches the text, no value is returned.
        </div>
        <div>
            The optional <code>threshold</code> (default is 0.4) allows control over the match strictness.
            A low value (min 0.0) means the match is very strict.
            At 1.0 (max) the match is very loose and will match anything.
        </div>
        <div>
            The returned value passes to the next command through the pipe.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/fuzzy list=["a","b","c"] threshold=0.4 abc</code></pre>
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'pass',
    callback: (_, arg) => arg,
    returns: 'the provided value',
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text', [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.NUMBER, ARGUMENT_TYPE.BOOLEAN, ARGUMENT_TYPE.LIST, ARGUMENT_TYPE.DICTIONARY, ARGUMENT_TYPE.CLOSURE], true,
        ),
    ],
    aliases: ['return'],
    helpString: `
        <div>
            <pre><span class="monospace">/pass (text)</span> – passes the text to the next command through the pipe.</pre>
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li><pre><code>/pass Hello world</code></pre></li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'delay',
    callback: delayCallback,
    aliases: ['wait', 'sleep'],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'milliseconds', [ARGUMENT_TYPE.NUMBER], true,
        ),
    ],
    helpString: `
        <div>
            Delays the next command in the pipe by the specified number of milliseconds.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/delay 1000</code></pre>
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'input',
    aliases: ['prompt'],
    callback: inputCallback,
    returns: 'user input',
    namedArgumentList: [
        new SlashCommandNamedArgument(
            'default', 'default value of the input field', [ARGUMENT_TYPE.STRING], false, false, '"string"',
        ),
        new SlashCommandNamedArgument(
            'large', 'show large input field', [ARGUMENT_TYPE.BOOLEAN], false, false, 'off', ['on', 'off'],
        ),
        new SlashCommandNamedArgument(
            'wide', 'show wide input field', [ARGUMENT_TYPE.BOOLEAN], false, false, 'off', ['on', 'off'],
        ),
        new SlashCommandNamedArgument(
            'okButton', 'text for the ok button', [ARGUMENT_TYPE.STRING], false,
        ),
        new SlashCommandNamedArgument(
            'rows', 'number of rows for the input field', [ARGUMENT_TYPE.NUMBER], false,
        ),
    ],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text to display', [ARGUMENT_TYPE.STRING], false,
        ),
    ],
    helpString: `
        <div>
            Shows a popup with the provided text and an input field.
            The <code>default</code> argument is the default value of the input field, and the text argument is the text to display.
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'run',
    aliases: ['call', 'exec'],
    callback: runCallback,
    returns: 'result of the executed closure of QR',
    namedArgumentList: [
        new SlashCommandNamedArgument(
            'args', 'named arguments', [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.NUMBER, ARGUMENT_TYPE.BOOLEAN, ARGUMENT_TYPE.LIST, ARGUMENT_TYPE.DICTIONARY], false, true,
        ),
    ],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'scoped variable or qr label', [ARGUMENT_TYPE.VARIABLE_NAME, ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: `
        <div>
            Runs a closure from a scoped variable, or a Quick Reply with the specified name from a currently active preset or from another preset.
            Named arguments can be referenced in a QR with <code>{{arg::key}}</code>.
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'messages',
    callback: getMessagesCallback,
    aliases: ['message'],
    namedArgumentList: [
        new SlashCommandNamedArgument(
            'names', 'show message author names', [ARGUMENT_TYPE.BOOLEAN], false, false, 'off', ['off', 'on'],
        ),
    ],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'message index or range', [ARGUMENT_TYPE.NUMBER, ARGUMENT_TYPE.RANGE], false, true,
        ),
    ],
    returns: 'the specified message or range of messages as a string',
    helpString: `
        <div>
            Returns the specified message or range of messages as a string.
        </div>
        <div>
            <strong>Examples:</strong>
            <ul>
                <li>
                    <pre><code>/messages 10</code></pre>
                    Returns the 10th message.
                </li>
                <li>
                    <pre><code>/messages names=on 5-10</code></pre>
                    Returns messages 5 through 10 with author names.
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'setinput',
    callback: setInputCallback,
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: `
        <div>
            Sets the user input to the specified text and passes it to the next command through the pipe.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/setinput Hello world</code></pre>
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'popup',
    callback: popupCallback,
    returns: 'popup text',
    namedArgumentList: [
        new SlashCommandNamedArgument(
            'large', 'show large popup', [ARGUMENT_TYPE.BOOLEAN], false, false, null, ['on', 'off'],
        ),
        new SlashCommandNamedArgument(
            'wide', 'show wide popup', [ARGUMENT_TYPE.BOOLEAN], false, false, null, ['on', 'off'],
        ),
        new SlashCommandNamedArgument(
            'okButton', 'text for the OK button', [ARGUMENT_TYPE.STRING], false,
        ),
    ],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: `
        <div>
            Shows a blocking popup with the specified text and buttons.
            Returns the popup text.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/popup large=on wide=on okButton="Submit" Enter some text:</code></pre>
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'buttons',
    callback: buttonsCallback,
    returns: 'clicked button label',
    namedArgumentList: [
        new SlashCommandNamedArgument(
            'labels', 'button labels', [ARGUMENT_TYPE.LIST], true,
        ),
    ],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: `
        <div>
            Shows a blocking popup with the specified text and buttons.
            Returns the clicked button label into the pipe or empty string if canceled.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/buttons labels=["Yes","No"] Do you want to continue?</code></pre>
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'trimtokens',
    callback: trimTokensCallback,
    returns: 'trimmed text',
    namedArgumentList: [
        new SlashCommandNamedArgument(
            'limit', 'number of tokens to keep', [ARGUMENT_TYPE.NUMBER], true,
        ),
        new SlashCommandNamedArgument(
            'direction', 'trim direction', [ARGUMENT_TYPE.STRING], true, false, null, ['start', 'end'],
        ),
    ],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text', [ARGUMENT_TYPE.STRING], false,
        ),
    ],
    helpString: `
        <div>
            Trims the start or end of text to the specified number of tokens.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/trimtokens limit=5 direction=start This is a long sentence with many words</code></pre>
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'trimstart',
    callback: trimStartCallback,
    returns: 'trimmed text',
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: `
        <div>
            Trims the text to the start of the first full sentence.
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code>/trimstart This is a sentence. And here is another sentence.</code></pre>
                </li>
            </ul>
        </div>
    `,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'trimend',
    callback: trimEndCallback,
    returns: 'trimmed text',
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: 'Trims the text to the end of the last full sentence.',
    interruptsGeneration: true,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'inject',
    callback: injectCallback,
    namedArgumentList: [
        new SlashCommandNamedArgument(
            'id', 'injection ID', [ARGUMENT_TYPE.STRING], true,
        ),
        new SlashCommandNamedArgument(
            'position', 'injection position', [ARGUMENT_TYPE.STRING], false, false, 'after', ['before', 'after', 'chat'],
        ),
        new SlashCommandNamedArgument(
            'depth', 'injection depth', [ARGUMENT_TYPE.NUMBER], false, false, '4',
        ),
        new SlashCommandNamedArgument(
            'scan', 'include injection content into World Info scans', [ARGUMENT_TYPE.BOOLEAN], false, false, 'false',
        ),
        new SlashCommandNamedArgument(
            'role', 'role for in-chat injections', [ARGUMENT_TYPE.STRING], false, false, 'system', ['system', 'user', 'assistant'],
        ),
    ],
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text', [ARGUMENT_TYPE.STRING], false,
        ),
    ],
    helpString: 'Injects a text into the LLM prompt for the current chat. Requires a unique injection ID. Positions: "before" main prompt, "after" main prompt, in-"chat" (default: after). Depth: injection depth for the prompt (default: 4). Role: role for in-chat injections (default: system). Scan: include injection content into World Info scans (default: false).',
    interruptsGeneration: true,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'listinjects',
    callback: listInjectsCallback,
    helpString: 'Lists all script injections for the current chat.',
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'flushinjects',
    callback: flushInjectsCallback,
    helpString: 'Removes all script injections for the current chat.',
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'tokens',
    callback: (_, text) => getTokenCountAsync(text),
    returns: 'number of tokens',
    unnamedArgumentList: [
        new SlashCommandArgument(
            'text', [ARGUMENT_TYPE.STRING], true,
        ),
    ],
    helpString: 'Counts the number of tokens in the provided text.',
    interruptsGeneration: true,
    purgeFromMessage: true,
}));
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'model',
    callback: modelCallback,
    returns: 'current model',
    unnamedArgumentList: [
        new SlashCommandArgument(
            'model name', [ARGUMENT_TYPE.STRING], false,
        ),
    ],
    helpString: 'Sets the model for the current API. Gets the current model name if no argument is provided.',
    interruptsGeneration: true,
    purgeFromMessage: true,
}));

registerVariableCommands();

const NARRATOR_NAME_KEY = 'narrator_name';
const NARRATOR_NAME_DEFAULT = 'System';
export const COMMENT_NAME_DEFAULT = 'Note';
const SCRIPT_PROMPT_KEY = 'script_inject_';

function injectCallback(args, value) {
    const positions = {
        'before': extension_prompt_types.BEFORE_PROMPT,
        'after': extension_prompt_types.IN_PROMPT,
        'chat': extension_prompt_types.IN_CHAT,
    };
    const roles = {
        'system': extension_prompt_roles.SYSTEM,
        'user': extension_prompt_roles.USER,
        'assistant': extension_prompt_roles.ASSISTANT,
    };

    const id = resolveVariable(args?.id);

    if (!id) {
        console.warn('WARN: No ID provided for /inject command');
        toastr.warning('No ID provided for /inject command');
        return '';
    }

    const defaultPosition = 'after';
    const defaultDepth = 4;
    const positionValue = args?.position ?? defaultPosition;
    const position = positions[positionValue] ?? positions[defaultPosition];
    const depthValue = Number(args?.depth) ?? defaultDepth;
    const depth = isNaN(depthValue) ? defaultDepth : depthValue;
    const roleValue = typeof args?.role === 'string' ? args.role.toLowerCase().trim() : Number(args?.role ?? extension_prompt_roles.SYSTEM);
    const role = roles[roleValue] ?? roles[extension_prompt_roles.SYSTEM];
    const scan = isTrueBoolean(args?.scan);
    value = value || '';

    const prefixedId = `${SCRIPT_PROMPT_KEY}${id}`;

    if (!chat_metadata.script_injects) {
        chat_metadata.script_injects = {};
    }

    if (value) {
        const inject = { value, position, depth, scan, role };
        chat_metadata.script_injects[id] = inject;
    } else {
        delete chat_metadata.script_injects[id];
    }

    setExtensionPrompt(prefixedId, value, position, depth, scan, role);
    saveMetadataDebounced();
    return '';
}

function listInjectsCallback() {
    if (!chat_metadata.script_injects) {
        toastr.info('No script injections for the current chat');
        return '';
    }

    const injects = Object.entries(chat_metadata.script_injects)
        .map(([id, inject]) => {
            const position = Object.entries(extension_prompt_types);
            const positionName = position.find(([_, value]) => value === inject.position)?.[0] ?? 'unknown';
            return `* **${id}**: <code>${inject.value}</code> (${positionName}, depth: ${inject.depth}, scan: ${inject.scan ?? false}, role: ${inject.role ?? extension_prompt_roles.SYSTEM})`;
        })
        .join('\n');

    const converter = new showdown.Converter();
    const messageText = `### Script injections:\n${injects}`;
    const htmlMessage = DOMPurify.sanitize(converter.makeHtml(messageText));

    sendSystemMessage(system_message_types.GENERIC, htmlMessage);
}

function flushInjectsCallback() {
    if (!chat_metadata.script_injects) {
        return '';
    }

    for (const [id, inject] of Object.entries(chat_metadata.script_injects)) {
        const prefixedId = `${SCRIPT_PROMPT_KEY}${id}`;
        setExtensionPrompt(prefixedId, '', inject.position, inject.depth, inject.scan, inject.role);
    }

    chat_metadata.script_injects = {};
    saveMetadataDebounced();
    return '';
}

export function processChatSlashCommands() {
    const context = getContext();

    if (!(context.chatMetadata.script_injects)) {
        return;
    }

    for (const id of Object.keys(context.extensionPrompts)) {
        if (!id.startsWith(SCRIPT_PROMPT_KEY)) {
            continue;
        }

        console.log('Removing script injection', id);
        delete context.extensionPrompts[id];
    }

    for (const [id, inject] of Object.entries(context.chatMetadata.script_injects)) {
        const prefixedId = `${SCRIPT_PROMPT_KEY}${id}`;
        console.log('Adding script injection', id);
        setExtensionPrompt(prefixedId, inject.value, inject.position, inject.depth, inject.scan, inject.role);
    }
}

function setInputCallback(_, value) {
    $('#send_textarea').val(value || '')[0].dispatchEvent(new Event('input', { bubbles:true }));
    return value;
}

function trimStartCallback(_, value) {
    if (!value) {
        return '';
    }

    return trimToStartSentence(value);
}

function trimEndCallback(_, value) {
    if (!value) {
        return '';
    }

    return trimToEndSentence(value);
}

async function trimTokensCallback(arg, value) {
    if (!value) {
        console.warn('WARN: No argument provided for /trimtokens command');
        return '';
    }

    const limit = Number(resolveVariable(arg.limit));

    if (isNaN(limit)) {
        console.warn(`WARN: Invalid limit provided for /trimtokens command: ${limit}`);
        return value;
    }

    if (limit <= 0) {
        return '';
    }

    const direction = arg.direction || 'end';
    const tokenCount = await getTokenCountAsync(value);

    // Token count is less than the limit, do nothing
    if (tokenCount <= limit) {
        return value;
    }

    const { tokenizerName, tokenizerId } = getFriendlyTokenizerName(main_api);
    console.debug('Requesting tokenization for /trimtokens command', tokenizerName);

    try {
        const textTokens = getTextTokens(tokenizerId, value);

        if (!Array.isArray(textTokens) || !textTokens.length) {
            console.warn('WARN: No tokens returned for /trimtokens command, falling back to estimation');
            const percentage = limit / tokenCount;
            const trimIndex = Math.floor(value.length * percentage);
            const trimmedText = direction === 'start' ? value.substring(trimIndex) : value.substring(0, value.length - trimIndex);
            return trimmedText;
        }

        const sliceTokens = direction === 'start' ? textTokens.slice(0, limit) : textTokens.slice(-limit);
        const { text } = decodeTextTokens(tokenizerId, sliceTokens);
        return text;
    } catch (error) {
        console.warn('WARN: Tokenization failed for /trimtokens command, returning original', error);
        return value;
    }
}

async function buttonsCallback(args, text) {
    try {
        const buttons = JSON.parse(resolveVariable(args?.labels));

        if (!Array.isArray(buttons) || !buttons.length) {
            console.warn('WARN: Invalid labels provided for /buttons command');
            return '';
        }

        return new Promise(async (resolve) => {
            const safeValue = DOMPurify.sanitize(text || '');

            const buttonContainer = document.createElement('div');
            buttonContainer.classList.add('flex-container', 'flexFlowColumn', 'wide100p', 'm-t-1');

            for (const button of buttons) {
                const buttonElement = document.createElement('div');
                buttonElement.classList.add('menu_button', 'wide100p');
                buttonElement.addEventListener('click', () => {
                    resolve(button);
                    $('#dialogue_popup_ok').trigger('click');
                });
                buttonElement.innerText = button;
                buttonContainer.appendChild(buttonElement);
            }

            const popupContainer = document.createElement('div');
            popupContainer.innerHTML = safeValue;
            popupContainer.appendChild(buttonContainer);
            callPopup(popupContainer, 'text', '', { okButton: 'Cancel' })
                .then(() => resolve(''))
                .catch(() => resolve(''));
        });
    } catch {
        return '';
    }
}

async function popupCallback(args, value) {
    const safeValue = DOMPurify.sanitize(value || '');
    const popupOptions = {
        large: isTrueBoolean(args?.large),
        wide: isTrueBoolean(args?.wide),
        okButton: args?.okButton !== undefined && typeof args?.okButton === 'string' ? args.okButton : 'Ok',
    };
    await delay(1);
    await callPopup(safeValue, 'text', '', popupOptions);
    await delay(1);
    return value;
}

function getMessagesCallback(args, value) {
    const includeNames = !isFalseBoolean(args?.names);
    const range = stringToRange(value, 0, chat.length - 1);

    if (!range) {
        console.warn(`WARN: Invalid range provided for /getmessages command: ${value}`);
        return '';
    }

    const messages = [];

    for (let messageId = range.start; messageId <= range.end; messageId++) {
        const message = chat[messageId];
        if (!message) {
            console.warn(`WARN: No message found with ID ${messageId}`);
            continue;
        }

        if (message.is_system) {
            continue;
        }

        if (includeNames) {
            messages.push(`${message.name}: ${message.mes}`);
        } else {
            messages.push(message.mes);
        }
    }

    return messages.join('\n\n');
}

async function runCallback(args, name) {
    if (!name) {
        throw new Error('No name provided for /run command');
    }

    /**@type {SlashCommandScope} */
    const scope = args._scope;
    if (scope.existsVariable(name)) {
        const closure = scope.getVariable(name);
        if (!(closure instanceof SlashCommandClosure)) {
            throw new Error(`"${name}" is not callable.`);
        }
        closure.scope.parent = scope;
        Object.keys(closure.argumentList).forEach(key=>{
            if (Object.keys(args).includes(key)) {
                closure.providedArgumentList[key] = args[key];
            }
        });
        const result = await closure.execute();
        return result.pipe;
    }

    if (typeof window['executeQuickReplyByName'] !== 'function') {
        throw new Error('Quick Reply extension is not loaded');
    }

    try {
        name = name.trim();
        return await window['executeQuickReplyByName'](name, args);
    } catch (error) {
        throw new Error(`Error running Quick Reply "${name}": ${error.message}`, 'Error');
    }
}

function abortCallback() {
    $('#send_textarea').val('')[0].dispatchEvent(new Event('input', { bubbles:true }));
    throw new Error('/abort command executed');
}

async function delayCallback(_, amount) {
    if (!amount) {
        console.warn('WARN: No amount provided for /delay command');
        return;
    }

    amount = Number(amount);
    if (isNaN(amount)) {
        amount = 0;
    }

    await delay(amount);
}

async function inputCallback(args, prompt) {
    const safeValue = DOMPurify.sanitize(prompt || '');
    const defaultInput = args?.default !== undefined && typeof args?.default === 'string' ? args.default : '';
    const popupOptions = {
        large: isTrueBoolean(args?.large),
        wide: isTrueBoolean(args?.wide),
        okButton: args?.okButton !== undefined && typeof args?.okButton === 'string' ? args.okButton : 'Ok',
        rows: args?.rows !== undefined && typeof args?.rows === 'string' ? isNaN(Number(args.rows)) ? 4 : Number(args.rows) : 4,
    };
    // Do not remove this delay, otherwise the prompt will not show up
    await delay(1);
    const result = await callPopup(safeValue, 'input', defaultInput, popupOptions);
    await delay(1);
    return result || '';
}

/**
 * Each item in "args.list" is searched within "search_item" using fuzzy search. If any matches it returns the matched "item".
 * @param {FuzzyCommandArgs} args - arguments containing "list" (JSON array) and optionaly "threshold" (float between 0.0 and 1.0)
 * @param {string} searchInValue - the string where items of list are searched
 * @returns {string} - the matched item from the list
 * @typedef {{list: string, threshold: string}} FuzzyCommandArgs - arguments for /fuzzy command
 * @example /fuzzy list=["down","left","up","right"] "he looks up" | /echo // should return "up"
 * @link https://www.fusejs.io/
 */
function fuzzyCallback(args, searchInValue) {
    if (!searchInValue) {
        console.warn('WARN: No argument provided for /fuzzy command');
        return '';
    }

    if (!args.list) {
        console.warn('WARN: No list argument provided for /fuzzy command');
        return '';
    }

    try {
        const list = JSON.parse(resolveVariable(args.list));
        if (!Array.isArray(list)) {
            console.warn('WARN: Invalid list argument provided for /fuzzy command');
            return '';
        }

        const params = {
            includeScore: true,
            findAllMatches: true,
            ignoreLocation: true,
            threshold: 0.4,
        };
        // threshold determines how strict is the match, low threshold value is very strict, at 1 (nearly?) everything matches
        if ('threshold' in args) {
            params.threshold = parseFloat(resolveVariable(args.threshold));
            if (isNaN(params.threshold)) {
                console.warn('WARN: \'threshold\' argument must be a float between 0.0 and 1.0 for /fuzzy command');
                return '';
            }
            if (params.threshold < 0) {
                params.threshold = 0;
            }
            if (params.threshold > 1) {
                params.threshold = 1;
            }
        }

        const fuse = new Fuse([searchInValue], params);
        // each item in the "list" is searched within "search_item", if any matches it returns the matched "item"
        for (const searchItem of list) {
            const result = fuse.search(searchItem);
            if (result.length > 0) {
                console.info('fuzzyCallback Matched: ' + searchItem);
                return searchItem;
            }
        }
        return '';
    } catch {
        console.warn('WARN: Invalid list argument provided for /fuzzy command');
        return '';
    }
}

function setEphemeralStopStrings(value) {
    if (typeof value === 'string' && value.length) {
        try {
            const stopStrings = JSON.parse(value);
            if (Array.isArray(stopStrings)) {
                stopStrings.forEach(stopString => addEphemeralStoppingString(stopString));
            }
        } catch {
            // Do nothing
        }
    }
}

async function generateRawCallback(args, value) {
    if (!value) {
        console.warn('WARN: No argument provided for /genraw command');
        return;
    }

    // Prevent generate recursion
    $('#send_textarea').val('')[0].dispatchEvent(new Event('input', { bubbles:true }));
    const lock = isTrueBoolean(args?.lock);
    const as = args?.as || 'system';
    const quietToLoud = as === 'char';
    const systemPrompt = resolveVariable(args?.system) || '';
    const length = Number(resolveVariable(args?.length) ?? 0) || 0;

    try {
        if (lock) {
            deactivateSendButtons();
        }

        setEphemeralStopStrings(resolveVariable(args?.stop));
        const result = await generateRaw(value, '', isFalseBoolean(args?.instruct), quietToLoud, systemPrompt, length);
        return result;
    } finally {
        if (lock) {
            activateSendButtons();
        }
        flushEphemeralStoppingStrings();
    }
}

async function generateCallback(args, value) {
    if (!value) {
        console.warn('WARN: No argument provided for /gen command');
        return;
    }

    // Prevent generate recursion
    $('#send_textarea').val('')[0].dispatchEvent(new Event('input', { bubbles:true }));
    const lock = isTrueBoolean(args?.lock);
    const as = args?.as || 'system';
    const quietToLoud = as === 'char';
    const length = Number(resolveVariable(args?.length) ?? 0) || 0;

    try {
        if (lock) {
            deactivateSendButtons();
        }

        setEphemeralStopStrings(resolveVariable(args?.stop));
        const name = args?.name;
        const result = await generateQuietPrompt(value, quietToLoud, false, '', name, length);
        return result;
    } finally {
        if (lock) {
            activateSendButtons();
        }
        flushEphemeralStoppingStrings();
    }
}

async function echoCallback(args, value) {
    const safeValue = DOMPurify.sanitize(String(value) || '');
    if (safeValue === '') {
        console.warn('WARN: No argument provided for /echo command');
        return;
    }
    const title = args?.title !== undefined && typeof args?.title === 'string' ? args.title : undefined;
    const severity = args?.severity !== undefined && typeof args?.severity === 'string' ? args.severity : 'info';
    switch (severity) {
        case 'error':
            toastr.error(safeValue, title);
            break;
        case 'warning':
            toastr.warning(safeValue, title);
            break;
        case 'success':
            toastr.success(safeValue, title);
            break;
        case 'info':
        default:
            toastr.info(safeValue, title);
            break;
    }
    return value;
}

async function addSwipeCallback(_, arg) {
    const lastMessage = chat[chat.length - 1];

    if (!lastMessage) {
        toastr.warning('No messages to add swipes to.');
        return;
    }

    if (!arg) {
        console.warn('WARN: No argument provided for /addswipe command');
        return;
    }

    if (lastMessage.is_user) {
        toastr.warning('Can\'t add swipes to user messages.');
        return;
    }

    if (lastMessage.is_system) {
        toastr.warning('Can\'t add swipes to system messages.');
        return;
    }

    if (lastMessage.extra?.image) {
        toastr.warning('Can\'t add swipes to message containing an image.');
        return;
    }

    if (!Array.isArray(lastMessage.swipes)) {
        lastMessage.swipes = [lastMessage.mes];
        lastMessage.swipe_info = [{}];
        lastMessage.swipe_id = 0;
    }

    lastMessage.swipes.push(arg);
    lastMessage.swipe_info.push({
        send_date: getMessageTimeStamp(),
        gen_started: null,
        gen_finished: null,
        extra: {
            bias: extractMessageBias(arg),
            gen_id: Date.now(),
            api: 'manual',
            model: 'slash command',
        },
    });

    await saveChatConditional();
    await reloadCurrentChat();
}

async function deleteSwipeCallback(_, arg) {
    const lastMessage = chat[chat.length - 1];

    if (!lastMessage || !Array.isArray(lastMessage.swipes) || !lastMessage.swipes.length) {
        toastr.warning('No messages to delete swipes from.');
        return;
    }

    if (lastMessage.swipes.length <= 1) {
        toastr.warning('Can\'t delete the last swipe.');
        return;
    }

    const swipeId = arg && !isNaN(Number(arg)) ? (Number(arg) - 1) : lastMessage.swipe_id;

    if (swipeId < 0 || swipeId >= lastMessage.swipes.length) {
        toastr.warning(`Invalid swipe ID: ${swipeId + 1}`);
        return;
    }

    lastMessage.swipes.splice(swipeId, 1);

    if (Array.isArray(lastMessage.swipe_info) && lastMessage.swipe_info.length) {
        lastMessage.swipe_info.splice(swipeId, 1);
    }

    const newSwipeId = Math.min(swipeId, lastMessage.swipes.length - 1);
    lastMessage.swipe_id = newSwipeId;
    lastMessage.mes = lastMessage.swipes[newSwipeId];

    await saveChatConditional();
    await reloadCurrentChat();
}

async function askCharacter(_, text) {
    // Prevent generate recursion
    $('#send_textarea').val('')[0].dispatchEvent(new Event('input', { bubbles:true }));

    // Not supported in group chats
    // TODO: Maybe support group chats?
    if (selected_group) {
        toastr.error('Cannot run this command in a group chat!');
        return;
    }

    if (!text) {
        console.warn('WARN: No text provided for /ask command');
    }

    const parts = text.split('\n');
    if (parts.length <= 1) {
        toastr.warning('Both character name and message are required. Separate them with a new line.');
        return;
    }

    // Grabbing the message
    const name = parts.shift().trim();
    let mesText = parts.join('\n').trim();
    const prevChId = this_chid;

    // Find the character
    const chId = characters.findIndex((e) => e.name === name);
    if (!characters[chId] || chId === -1) {
        toastr.error('Character not found.');
        return;
    }

    // Override character and send a user message
    setCharacterId(chId);

    // TODO: Maybe look up by filename instead of name
    const character = characters[chId];
    let force_avatar, original_avatar;

    if (character && character.avatar !== 'none') {
        force_avatar = getThumbnailUrl('avatar', character.avatar);
        original_avatar = character.avatar;
    }
    else {
        force_avatar = default_avatar;
        original_avatar = default_avatar;
    }

    setCharacterName(character.name);

    await sendMessageAsUser(mesText, '');

    const restoreCharacter = () => {
        setCharacterId(prevChId);
        setCharacterName(characters[prevChId].name);

        // Only force the new avatar if the character name is the same
        // This skips if an error was fired
        const lastMessage = chat[chat.length - 1];
        if (lastMessage && lastMessage?.name === character.name) {
            lastMessage.force_avatar = force_avatar;
            lastMessage.original_avatar = original_avatar;
        }

        // Kill this callback once the event fires
        eventSource.removeListener(event_types.CHARACTER_MESSAGE_RENDERED, restoreCharacter);
    };

    // Run generate and restore previous character on error
    try {
        toastr.info(`Asking ${character.name} something...`);
        await Generate('ask_command');
    } catch {
        restoreCharacter();
    }

    // Restore previous character once message renders
    // Hack for generate
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, restoreCharacter);
}

async function hideMessageCallback(_, arg) {
    if (!arg) {
        console.warn('WARN: No argument provided for /hide command');
        return;
    }

    const range = stringToRange(arg, 0, chat.length - 1);

    if (!range) {
        console.warn(`WARN: Invalid range provided for /hide command: ${arg}`);
        return;
    }

    await hideChatMessageRange(range.start, range.end, false);
}

async function unhideMessageCallback(_, arg) {
    if (!arg) {
        console.warn('WARN: No argument provided for /unhide command');
        return '';
    }

    const range = stringToRange(arg, 0, chat.length - 1);

    if (!range) {
        console.warn(`WARN: Invalid range provided for /unhide command: ${arg}`);
        return '';
    }

    await hideChatMessageRange(range.start, range.end, true);
    return '';
}

/**
 * Copium for running group actions when the member is offscreen.
 * @param {number} chid - character ID
 * @param {string} action - one of 'enable', 'disable', 'up', 'down', 'view', 'remove'
 * @returns {void}
 */
function performGroupMemberAction(chid, action) {
    const memberSelector = `.group_member[chid="${chid}"]`;
    // Do not optimize. Paginator gets recreated on every action
    const paginationSelector = '#rm_group_members_pagination';
    const pageSizeSelector = '#rm_group_members_pagination select';
    let wasOffscreen = false;
    let paginationValue = null;
    let pageValue = null;

    if ($(memberSelector).length === 0) {
        wasOffscreen = true;
        paginationValue = Number($(pageSizeSelector).val());
        pageValue = $(paginationSelector).pagination('getCurrentPageNum');
        $(pageSizeSelector).val($(pageSizeSelector).find('option').last().val()).trigger('change');
    }

    $(memberSelector).find(`[data-action="${action}"]`).trigger('click');

    if (wasOffscreen) {
        $(pageSizeSelector).val(paginationValue).trigger('change');
        if ($(paginationSelector).length) {
            $(paginationSelector).pagination('go', pageValue);
        }
    }
}

async function disableGroupMemberCallback(_, arg) {
    if (!selected_group) {
        toastr.warning('Cannot run /disable command outside of a group chat.');
        return '';
    }

    const chid = findGroupMemberId(arg);

    if (chid === undefined) {
        console.warn(`WARN: No group member found for argument ${arg}`);
        return '';
    }

    performGroupMemberAction(chid, 'disable');
    return '';
}

async function enableGroupMemberCallback(_, arg) {
    if (!selected_group) {
        toastr.warning('Cannot run /enable command outside of a group chat.');
        return '';
    }

    const chid = findGroupMemberId(arg);

    if (chid === undefined) {
        console.warn(`WARN: No group member found for argument ${arg}`);
        return '';
    }

    performGroupMemberAction(chid, 'enable');
    return '';
}

async function moveGroupMemberUpCallback(_, arg) {
    if (!selected_group) {
        toastr.warning('Cannot run /memberup command outside of a group chat.');
        return '';
    }

    const chid = findGroupMemberId(arg);

    if (chid === undefined) {
        console.warn(`WARN: No group member found for argument ${arg}`);
        return '';
    }

    performGroupMemberAction(chid, 'up');
    return '';
}

async function moveGroupMemberDownCallback(_, arg) {
    if (!selected_group) {
        toastr.warning('Cannot run /memberdown command outside of a group chat.');
        return '';
    }

    const chid = findGroupMemberId(arg);

    if (chid === undefined) {
        console.warn(`WARN: No group member found for argument ${arg}`);
        return '';
    }

    performGroupMemberAction(chid, 'down');
    return '';
}

async function peekCallback(_, arg) {
    if (!selected_group) {
        toastr.warning('Cannot run /peek command outside of a group chat.');
        return '';
    }

    if (is_group_generating) {
        toastr.warning('Cannot run /peek command while the group reply is generating.');
        return '';
    }

    const chid = findGroupMemberId(arg);

    if (chid === undefined) {
        console.warn(`WARN: No group member found for argument ${arg}`);
        return '';
    }

    performGroupMemberAction(chid, 'view');
    return '';
}

async function removeGroupMemberCallback(_, arg) {
    if (!selected_group) {
        toastr.warning('Cannot run /memberremove command outside of a group chat.');
        return '';
    }

    if (is_group_generating) {
        toastr.warning('Cannot run /memberremove command while the group reply is generating.');
        return '';
    }

    const chid = findGroupMemberId(arg);

    if (chid === undefined) {
        console.warn(`WARN: No group member found for argument ${arg}`);
        return '';
    }

    performGroupMemberAction(chid, 'remove');
    return '';
}

async function addGroupMemberCallback(_, arg) {
    if (!selected_group) {
        toastr.warning('Cannot run /memberadd command outside of a group chat.');
        return '';
    }

    if (!arg) {
        console.warn('WARN: No argument provided for /memberadd command');
        return '';
    }

    arg = arg.trim();
    const chid = findCharacterIndex(arg);

    if (chid === -1) {
        console.warn(`WARN: No character found for argument ${arg}`);
        return '';
    }

    const character = characters[chid];
    const group = groups.find(x => x.id === selected_group);

    if (!group || !Array.isArray(group.members)) {
        console.warn(`WARN: No group found for ID ${selected_group}`);
        return '';
    }

    const avatar = character.avatar;

    if (group.members.includes(avatar)) {
        toastr.warning(`${character.name} is already a member of this group.`);
        return '';
    }

    group.members.push(avatar);
    await saveGroupChat(selected_group, true);

    // Trigger to reload group UI
    $('#rm_button_selected_ch').trigger('click');
    return character.name;
}

async function triggerGenerationCallback(args, value) {
    const shouldAwait = isTrueBoolean(args?.await);
    const outerPromise = new Promise((outerResolve) => setTimeout(async () => {
        try {
            await waitUntilCondition(() => !is_send_press && !is_group_generating, 10000, 100);
        } catch {
            console.warn('Timeout waiting for generation unlock');
            toastr.warning('Cannot run /trigger command while the reply is being generated.');
            return '';
        }

        // Prevent generate recursion
        $('#send_textarea').val('')[0].dispatchEvent(new Event('input', { bubbles:true }));

        let chid = undefined;

        if (selected_group && value) {
            chid = findGroupMemberId(value);

            if (chid === undefined) {
                console.warn(`WARN: No group member found for argument ${value}`);
            }
        }

        outerResolve(new Promise(innerResolve => setTimeout(() => innerResolve(Generate('normal', { force_chid: chid })), 100)));
    }, 1));

    if (shouldAwait) {
        const innerPromise = await outerPromise;
        await innerPromise;
    }

    return '';
}

async function sendUserMessageCallback(args, text) {
    if (!text) {
        console.warn('WARN: No text provided for /send command');
        return;
    }

    text = text.trim();
    const compact = isTrueBoolean(args?.compact);
    const bias = extractMessageBias(text);
    const insertAt = Number(resolveVariable(args?.at));
    await sendMessageAsUser(text, bias, insertAt, compact);
    return '';
}

async function deleteMessagesByNameCallback(_, name) {
    if (!name) {
        console.warn('WARN: No name provided for /delname command');
        return;
    }

    name = name.trim();

    const messagesToDelete = [];
    chat.forEach((value) => {
        if (value.name === name) {
            messagesToDelete.push(value);
        }
    });

    if (!messagesToDelete.length) {
        console.debug('/delname: Nothing to delete');
        return;
    }

    for (const message of messagesToDelete) {
        const index = chat.indexOf(message);
        if (index !== -1) {
            console.debug(`/delname: Deleting message #${index}`, message);
            chat.splice(index, 1);
        }
    }

    await saveChatConditional();
    await reloadCurrentChat();

    toastr.info(`Deleted ${messagesToDelete.length} messages from ${name}`);
    return '';
}

function findCharacterIndex(name) {
    const matchTypes = [
        (a, b) => a === b,
        (a, b) => a.startsWith(b),
        (a, b) => a.includes(b),
    ];

    const exactAvatarMatch = characters.findIndex(x => x.avatar === name);

    if (exactAvatarMatch !== -1) {
        return exactAvatarMatch;
    }

    for (const matchType of matchTypes) {
        const index = characters.findIndex(x => matchType(x.name.toLowerCase(), name.toLowerCase()));
        if (index !== -1) {
            return index;
        }
    }

    return -1;
}

async function goToCharacterCallback(_, name) {
    if (!name) {
        console.warn('WARN: No character name provided for /go command');
        return;
    }

    name = name.trim();
    const characterIndex = findCharacterIndex(name);

    if (characterIndex !== -1) {
        await openChat(new String(characterIndex));
        setActiveCharacter(characters[characterIndex]?.avatar);
        setActiveGroup(null);
        return characters[characterIndex]?.name;
    } else {
        const group = groups.find(it => it.name.toLowerCase() == name.toLowerCase());
        if (group) {
            await openGroupById(group.id);
            setActiveCharacter(null);
            setActiveGroup(group.id);
            return group.name;
        } else {
            console.warn(`No matches found for name "${name}"`);
            return '';
        }
    }
}

async function openChat(id) {
    resetSelectedGroup();
    setCharacterId(id);
    await delay(1);
    await reloadCurrentChat();
}

function continueChatCallback(_, prompt) {
    setTimeout(async () => {
        try {
            await waitUntilCondition(() => !is_send_press && !is_group_generating, 10000, 100);
        } catch {
            console.warn('Timeout waiting for generation unlock');
            toastr.warning('Cannot run /continue command while the reply is being generated.');
        }

        // Prevent infinite recursion
        $('#send_textarea').val('')[0].dispatchEvent(new Event('input', { bubbles:true }));
        $('#option_continue').trigger('click', { fromSlashCommand: true, additionalPrompt: prompt });
    }, 1);

    return '';
}

export async function generateSystemMessage(_, prompt) {
    $('#send_textarea').val('')[0].dispatchEvent(new Event('input', { bubbles:true }));

    if (!prompt) {
        console.warn('WARN: No prompt provided for /sysgen command');
        toastr.warning('You must provide a prompt for the system message');
        return;
    }

    // Generate and regex the output if applicable
    toastr.info('Please wait', 'Generating...');
    let message = await generateQuietPrompt(prompt, false, false);
    message = getRegexedString(message, regex_placement.SLASH_COMMAND);

    sendNarratorMessage(_, message);
}

function syncCallback() {
    $('#sync_name_button').trigger('click');
}

function bindCallback() {
    $('#lock_user_name').trigger('click');
}

function setStoryModeCallback() {
    $('#chat_display').val(chat_styles.DOCUMENT).trigger('change');
}

function setBubbleModeCallback() {
    $('#chat_display').val(chat_styles.BUBBLES).trigger('change');
}

function setFlatModeCallback() {
    $('#chat_display').val(chat_styles.DEFAULT).trigger('change');
}

function setNameCallback(_, name) {
    if (!name) {
        toastr.warning('you must specify a name to change to');
        return;
    }

    name = name.trim();

    // If the name is a persona, auto-select it
    for (let persona of Object.values(power_user.personas)) {
        if (persona.toLowerCase() === name.toLowerCase()) {
            autoSelectPersona(name);
            retriggerFirstMessageOnEmptyChat();
            return;
        }
    }

    // Otherwise, set just the name
    setUserName(name); //this prevented quickReply usage
    retriggerFirstMessageOnEmptyChat();
}

async function setNarratorName(_, text) {
    const name = text || NARRATOR_NAME_DEFAULT;
    chat_metadata[NARRATOR_NAME_KEY] = name;
    toastr.info(`System narrator name set to ${name}`);
    await saveChatConditional();
}

export async function sendMessageAs(args, text) {
    if (!text) {
        return;
    }

    let name;
    let mesText;

    if (args.name) {
        name = args.name.trim();
        mesText = text.trim();

        if (!name && !text) {
            toastr.warning('You must specify a name and text to send as');
            return;
        }
    } else {
        const namelessWarningKey = 'sendAsNamelessWarningShown';
        if (localStorage.getItem(namelessWarningKey) !== 'true') {
            toastr.warning('To avoid confusion, please use /sendas name="Character Name"', 'Name defaulted to {{char}}', { timeOut: 10000 });
            localStorage.setItem(namelessWarningKey, 'true');
        }
        name = name2;
    }

    // Requires a regex check after the slash command is pushed to output
    mesText = getRegexedString(mesText, regex_placement.SLASH_COMMAND, { characterOverride: name });

    // Messages that do nothing but set bias will be hidden from the context
    const bias = extractMessageBias(mesText);
    const isSystem = bias && !removeMacros(mesText).length;
    const compact = isTrueBoolean(args?.compact);

    const character = characters.find(x => x.name === name);
    let force_avatar, original_avatar;

    if (character && character.avatar !== 'none') {
        force_avatar = getThumbnailUrl('avatar', character.avatar);
        original_avatar = character.avatar;
    }
    else {
        force_avatar = default_avatar;
        original_avatar = default_avatar;
    }

    const message = {
        name: name,
        is_user: false,
        is_system: isSystem,
        send_date: getMessageTimeStamp(),
        mes: substituteParams(mesText),
        force_avatar: force_avatar,
        original_avatar: original_avatar,
        extra: {
            bias: bias.trim().length ? bias : null,
            gen_id: Date.now(),
            isSmallSys: compact,
        },
    };

    const insertAt = Number(resolveVariable(args.at));

    if (!isNaN(insertAt) && insertAt >= 0 && insertAt <= chat.length) {
        chat.splice(insertAt, 0, message);
        await saveChatConditional();
        await eventSource.emit(event_types.MESSAGE_RECEIVED, insertAt);
        await reloadCurrentChat();
        await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, insertAt);
    } else {
        chat.push(message);
        await eventSource.emit(event_types.MESSAGE_RECEIVED, (chat.length - 1));
        addOneMessage(message);
        await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, (chat.length - 1));
        await saveChatConditional();
    }
}

export async function sendNarratorMessage(args, text) {
    if (!text) {
        return;
    }

    const name = chat_metadata[NARRATOR_NAME_KEY] || NARRATOR_NAME_DEFAULT;
    // Messages that do nothing but set bias will be hidden from the context
    const bias = extractMessageBias(text);
    const isSystem = bias && !removeMacros(text).length;
    const compact = isTrueBoolean(args?.compact);

    const message = {
        name: name,
        is_user: false,
        is_system: isSystem,
        send_date: getMessageTimeStamp(),
        mes: substituteParams(text.trim()),
        force_avatar: system_avatar,
        extra: {
            type: system_message_types.NARRATOR,
            bias: bias.trim().length ? bias : null,
            gen_id: Date.now(),
            isSmallSys: compact,
        },
    };

    const insertAt = Number(resolveVariable(args.at));

    if (!isNaN(insertAt) && insertAt >= 0 && insertAt <= chat.length) {
        chat.splice(insertAt, 0, message);
        await saveChatConditional();
        await eventSource.emit(event_types.MESSAGE_SENT, insertAt);
        await reloadCurrentChat();
        await eventSource.emit(event_types.USER_MESSAGE_RENDERED, insertAt);
    } else {
        chat.push(message);
        await eventSource.emit(event_types.MESSAGE_SENT, (chat.length - 1));
        addOneMessage(message);
        await eventSource.emit(event_types.USER_MESSAGE_RENDERED, (chat.length - 1));
        await saveChatConditional();
    }
}

export async function promptQuietForLoudResponse(who, text) {

    let character_id = getContext().characterId;
    if (who === 'sys') {
        text = 'System: ' + text;
    } else if (who === 'user') {
        text = name1 + ': ' + text;
    } else if (who === 'char') {
        text = characters[character_id].name + ': ' + text;
    } else if (who === 'raw') {
        // We don't need to modify the text
    }

    //text = `${text}${power_user.instruct.enabled ? '' : '\n'}${(power_user.always_force_name2 && who != 'raw') ? characters[character_id].name + ":" : ""}`

    let reply = await generateQuietPrompt(text, true, false);
    text = await getRegexedString(reply, regex_placement.SLASH_COMMAND);

    const message = {
        name: characters[character_id].name,
        is_user: false,
        is_name: true,
        is_system: false,
        send_date: getMessageTimeStamp(),
        mes: substituteParams(text.trim()),
        extra: {
            type: system_message_types.COMMENT,
            gen_id: Date.now(),
        },
    };

    chat.push(message);
    await eventSource.emit(event_types.MESSAGE_SENT, (chat.length - 1));
    addOneMessage(message);
    await eventSource.emit(event_types.USER_MESSAGE_RENDERED, (chat.length - 1));
    await saveChatConditional();

}

async function sendCommentMessage(args, text) {
    if (!text) {
        return;
    }

    const compact = isTrueBoolean(args?.compact);
    const message = {
        name: COMMENT_NAME_DEFAULT,
        is_user: false,
        is_system: true,
        send_date: getMessageTimeStamp(),
        mes: substituteParams(text.trim()),
        force_avatar: comment_avatar,
        extra: {
            type: system_message_types.COMMENT,
            gen_id: Date.now(),
            isSmallSys: compact,
        },
    };

    const insertAt = Number(resolveVariable(args.at));

    if (!isNaN(insertAt) && insertAt >= 0 && insertAt <= chat.length) {
        chat.splice(insertAt, 0, message);
        await saveChatConditional();
        await eventSource.emit(event_types.MESSAGE_SENT, insertAt);
        await reloadCurrentChat();
        await eventSource.emit(event_types.USER_MESSAGE_RENDERED, insertAt);
    } else {
        chat.push(message);
        await eventSource.emit(event_types.MESSAGE_SENT, (chat.length - 1));
        addOneMessage(message);
        await eventSource.emit(event_types.USER_MESSAGE_RENDERED, (chat.length - 1));
        await saveChatConditional();
    }
}

/**
 * Displays a help message from the slash command
 * @param {any} _ Unused
 * @param {string} type Type of help to display
 */
function helpCommandCallback(_, type) {
    switch (type?.trim()?.toLowerCase()) {
        case 'slash':
        case 'commands':
        case 'slashes':
        case 'slash commands':
        case '1':
            sendSystemMessage(system_message_types.SLASH_COMMANDS);
            break;
        case 'format':
        case 'formatting':
        case 'formats':
        case 'chat formatting':
        case '2':
            sendSystemMessage(system_message_types.FORMATTING);
            break;
        case 'hotkeys':
        case 'hotkey':
        case '3':
            sendSystemMessage(system_message_types.HOTKEYS);
            break;
        case 'macros':
        case 'macro':
        case '4':
            sendSystemMessage(system_message_types.MACROS);
            break;
        default:
            sendSystemMessage(system_message_types.HELP);
            break;
    }
}

$(document).on('click', '[data-displayHelp]', function (e) {
    e.preventDefault();
    const page = String($(this).data('displayhelp'));
    helpCommandCallback(null, page);
});

function setBackgroundCallback(_, bg) {
    if (!bg) {
        // allow reporting of the background name if called without args
        // for use in ST Scripts via pipe
        return background_settings.name;
    }

    console.log('Set background to ' + bg);

    const bgElements = Array.from(document.querySelectorAll('.bg_example')).map((x) => ({ element: x, bgfile: x.getAttribute('bgfile') }));

    const fuse = new Fuse(bgElements, { keys: ['bgfile'] });
    const result = fuse.search(bg);

    if (!result.length) {
        toastr.error(`No background found with name "${bg}"`);
        return;
    }

    const bgElement = result[0].item.element;

    if (bgElement instanceof HTMLElement) {
        bgElement.click();
    }
}

/**
 * Sets a model for the current API.
 * @param {object} _ Unused
 * @param {string} model New model name
 * @returns {string} New or existing model name
 */
function modelCallback(_, model) {
    const modelSelectMap = [
        { id: 'model_togetherai_select', api: 'textgenerationwebui', type: textgen_types.TOGETHERAI },
        { id: 'openrouter_model', api: 'textgenerationwebui', type: textgen_types.OPENROUTER },
        { id: 'model_infermaticai_select', api: 'textgenerationwebui', type: textgen_types.INFERMATICAI },
        { id: 'model_dreamgen_select', api: 'textgenerationwebui', type: textgen_types.DREAMGEN },
        { id: 'mancer_model', api: 'textgenerationwebui', type: textgen_types.MANCER },
        { id: 'aphrodite_model', api: 'textgenerationwebui', type: textgen_types.APHRODITE },
        { id: 'ollama_model', api: 'textgenerationwebui', type: textgen_types.OLLAMA },
        { id: 'model_openai_select', api: 'openai', type: chat_completion_sources.OPENAI },
        { id: 'model_claude_select', api: 'openai', type: chat_completion_sources.CLAUDE },
        { id: 'model_windowai_select', api: 'openai', type: chat_completion_sources.WINDOWAI },
        { id: 'model_openrouter_select', api: 'openai', type: chat_completion_sources.OPENROUTER },
        { id: 'model_ai21_select', api: 'openai', type: chat_completion_sources.AI21 },
        { id: 'model_google_select', api: 'openai', type: chat_completion_sources.MAKERSUITE },
        { id: 'model_mistralai_select', api: 'openai', type: chat_completion_sources.MISTRALAI },
        { id: 'model_custom_select', api: 'openai', type: chat_completion_sources.CUSTOM },
        { id: 'model_cohere_select', api: 'openai', type: chat_completion_sources.COHERE },
        { id: 'model_perplexity_select', api: 'openai', type: chat_completion_sources.PERPLEXITY },
        { id: 'model_novel_select', api: 'novel', type: null },
        { id: 'horde_model', api: 'koboldhorde', type: null },
    ];

    function getSubType() {
        switch (main_api) {
            case 'textgenerationwebui':
                return textgenerationwebui_settings.type;
            case 'openai':
                return oai_settings.chat_completion_source;
            default:
                return null;
        }
    }

    const apiSubType = getSubType();
    const modelSelectItem = modelSelectMap.find(x => x.api == main_api && x.type == apiSubType)?.id;

    if (!modelSelectItem) {
        toastr.info('Setting a model for your API is not supported or not implemented yet.');
        return '';
    }

    const modelSelectControl = document.getElementById(modelSelectItem);

    if (!(modelSelectControl instanceof HTMLSelectElement)) {
        toastr.error(`Model select control not found: ${main_api}[${apiSubType}]`);
        return '';
    }

    const options = Array.from(modelSelectControl.options);

    if (!options.length) {
        toastr.warning('No model options found. Check your API settings.');
        return '';
    }

    model = String(model || '').trim();

    if (!model) {
        return modelSelectControl.value;
    }

    console.log('Set model to ' + model);

    let newSelectedOption = null;

    const fuse = new Fuse(options, { keys: ['text', 'value'] });
    const fuzzySearchResult = fuse.search(model);

    const exactValueMatch = options.find(x => x.value.trim().toLowerCase() === model.trim().toLowerCase());
    const exactTextMatch = options.find(x => x.text.trim().toLowerCase() === model.trim().toLowerCase());

    if (exactValueMatch) {
        newSelectedOption = exactValueMatch;
    } else if (exactTextMatch) {
        newSelectedOption = exactTextMatch;
    } else if (fuzzySearchResult.length) {
        newSelectedOption = fuzzySearchResult[0].item;
    }

    if (newSelectedOption) {
        modelSelectControl.value = newSelectedOption.value;
        $(modelSelectControl).trigger('change');
        toastr.success(`Model set to "${newSelectedOption.text}"`);
        return newSelectedOption.value;
    } else {
        toastr.warning(`No model found with name "${model}"`);
        return '';
    }
}


export let isExecutingCommandsFromChatInput = false;
export let commandsFromChatInputAbortController;

/**
 * Show command execution pause/stop buttons next to chat input.
 */
export function activateScriptButtons() {
    document.querySelector('#form_sheld').classList.add('isExecutingCommandsFromChatInput');
}

/**
 * Hide command execution pause/stop buttons next to chat input.
 */
export function deactivateScriptButtons() {
    document.querySelector('#form_sheld').classList.remove('isExecutingCommandsFromChatInput');
}

/**
 * Toggle pause/continue command execution. Only for commands executed via chat input.
 */
export function pauseScriptExecution() {
    if (commandsFromChatInputAbortController) {
        if (commandsFromChatInputAbortController.signal.paused) {
            commandsFromChatInputAbortController.continue('Clicked pause button');
            document.querySelector('#form_sheld').classList.remove('script_paused');
        } else {
            commandsFromChatInputAbortController.pause('Clicked pause button');
            document.querySelector('#form_sheld').classList.add('script_paused');
        }
    }
}

/**
 * Stop command execution. Only for commands executed via chat input.
 */
export function stopScriptExecution() {
    commandsFromChatInputAbortController?.abort('Clicked stop button');
}

/**
 * Clear up command execution progress bar above chat input.
 * @returns Promise<void>
 */
async function clearCommandProgress() {
    if (isExecutingCommandsFromChatInput) return;
    document.querySelector('#send_textarea').style.setProperty('--progDone', '1');
    await delay(250);
    if (isExecutingCommandsFromChatInput) return;
    document.querySelector('#send_textarea').style.transition = 'none';
    await delay(1);
    document.querySelector('#send_textarea').style.setProperty('--prog', '0%');
    document.querySelector('#send_textarea').style.setProperty('--progDone', '0');
    document.querySelector('#form_sheld').classList.remove('script_success');
    document.querySelector('#form_sheld').classList.remove('script_error');
    document.querySelector('#form_sheld').classList.remove('script_aborted');
    await delay(1);
    document.querySelector('#send_textarea').style.transition = null;
}
/**
 * Debounced version of clearCommandProgress.
 */
const clearCommandProgressDebounced = debounce(clearCommandProgress);

/**
 * @typedef ExecuteSlashCommandsOptions
 * @prop {boolean} [handleParserErrors] (true) Whether to handle parser errors (show toast on error) or throw.
 * @prop {SlashCommandScope} [scope] (null) The scope to be used when executing the commands.
 * @prop {boolean} [handleExecutionErrors] (false) Whether to handle execution errors (show toast on error) or throw
 * @prop {PARSER_FLAG[]} [parserFlags] (null) Parser flags to apply
 * @prop {SlashCommandAbortController} [abortController] (null) Controller used to abort or pause command execution
 * @prop {(done:number, total:number)=>void} [onProgress] (null) Callback to handle progress events
 */

/**
 * @typedef ExecuteSlashCommandsOnChatInputOptions
 * @prop {SlashCommandScope} [scope] (null) The scope to be used when executing the commands.
 * @prop {PARSER_FLAG[]} [parserFlags] (null) Parser flags to apply
 * @prop {boolean} [clearChatInput] (false) Whether to clear the chat input textarea
 */

/**
 * Execute slash commands while showing progress indicator and pause/stop buttons on
 * chat input.
 * @param {string} text Slash command text
 * @param {ExecuteSlashCommandsOnChatInputOptions} options
 */
export async function executeSlashCommandsOnChatInput(text, options = {}) {
    if (isExecutingCommandsFromChatInput) return null;

    options = Object.assign({
        scope: null,
        parserFlags: null,
        clearChatInput: false,
    }, options);

    isExecutingCommandsFromChatInput = true;
    commandsFromChatInputAbortController?.abort('processCommands was called');
    activateScriptButtons();

    /**@type {HTMLTextAreaElement}*/
    const ta = document.querySelector('#send_textarea');

    if (options.clearChatInput) {
        ta.value = '';
        ta.dispatchEvent(new Event('input', { bubbles:true }));
    }

    document.querySelector('#send_textarea').style.setProperty('--prog', '0%');
    document.querySelector('#send_textarea').style.setProperty('--progDone', '0');
    document.querySelector('#form_sheld').classList.remove('script_success');
    document.querySelector('#form_sheld').classList.remove('script_error');
    document.querySelector('#form_sheld').classList.remove('script_aborted');

    /**@type {SlashCommandClosureResult} */
    let result = null;
    try {
        commandsFromChatInputAbortController = new SlashCommandAbortController();
        result = await executeSlashCommandsWithOptions(text, {
            abortController: commandsFromChatInputAbortController,
            onProgress: (done, total)=>ta.style.setProperty('--prog', `${done / total * 100}%`),
        });
        if (commandsFromChatInputAbortController.signal.aborted) {
            document.querySelector('#form_sheld').classList.add('script_aborted');
        } else {
            document.querySelector('#form_sheld').classList.add('script_success');
        }
    } catch (e) {
        document.querySelector('#form_sheld').classList.add('script_error');
        toastr.error(e.message);
        result = new SlashCommandClosureResult();
        result.interrupt = true;
        result.isError = true;
        result.errorMessage = e.message;
    } finally {
        delay(1000).then(()=>clearCommandProgressDebounced());

        commandsFromChatInputAbortController = null;
        deactivateScriptButtons();
        isExecutingCommandsFromChatInput = false;
    }
    return result;
}

/**
 *
 * @param {string} text Slash command text
 * @param {ExecuteSlashCommandsOptions} [options]
 * @returns {Promise<SlashCommandClosureResult>}
 */
async function executeSlashCommandsWithOptions(text, options = {}) {
    if (!text) {
        return null;
    }
    options = Object.assign({
        handleParserErrors: true,
        scope: null,
        handleExecutionErrors: false,
        parserFlags: null,
        abortController: null,
        onProgress: null,
    }, options);

    let closure;
    try {
        closure = parser.parse(text, true, options.parserFlags, options.abortController);
        closure.scope.parent = options.scope;
        closure.onProgress = options.onProgress;
    } catch (e) {
        if (options.handleParserErrors && e instanceof SlashCommandParserError) {
            /**@type {SlashCommandParserError}*/
            const ex = e;
            const toast = `
                <div>${ex.message}</div>
                <div>Line: ${ex.line} Column: ${ex.column}</div>
                <pre style="text-align:left;">${ex.hint}</pre>
                `;
            const clickHint = '<p>Click to see details</p>';
            toastr.error(
                `${toast}${clickHint}`,
                'SlashCommandParserError',
                { escapeHtml:false, timeOut: 10000, onclick:()=>callPopup(toast, 'text') },
            );
            const result = new SlashCommandClosureResult();
            result.interrupt = true;
            return result;
        } else {
            throw e;
        }
    }

    try {
        const result = await closure.execute();
        if (result.isAborted) {
            toastr.warning(result.abortReason, 'Command execution aborted');
        }
        return result;
    } catch (e) {
        if (options.handleExecutionErrors) {
            toastr.error(e.message);
            const result = new SlashCommandClosureResult();
            result.interrupt = true;
            result.isError = true;
            result.errorMessage = e.message;
            return result;
        } else {
            throw e;
        }
    }
}
/**
 * Executes slash commands in the provided text
 * @deprecated Use executeSlashCommandWithOptions instead
 * @param {string} text Slash command text
 * @param {boolean} handleParserErrors Whether to handle parser errors (show toast on error) or throw
 * @param {SlashCommandScope} scope The scope to be used when executing the commands.
 * @param {boolean} handleExecutionErrors Whether to handle execution errors (show toast on error) or throw
 * @param {PARSER_FLAG[]} parserFlags Parser flags to apply
 * @param {SlashCommandAbortController} abortController Controller used to abort or pause command execution
 * @param {(done:number, total:number)=>void} onProgress Callback to handle progress events
 * @returns {Promise<SlashCommandClosureResult>}
 */
async function executeSlashCommands(text, handleParserErrors = true, scope = null, handleExecutionErrors = false, parserFlags = null, abortController = null, onProgress = null) {
    return executeSlashCommandsWithOptions(text, {
        handleParserErrors,
        scope,
        handleExecutionErrors,
        parserFlags,
        abortController,
        onProgress,
    });
}

/**
 *
 * @param {HTMLTextAreaElement} textarea The textarea to receive autocomplete
 * @param {Boolean} isFloating Whether to show the auto complete as a floating window (e.g., large QR editor)
 */
export async function setSlashCommandAutoComplete(textarea, isFloating = false) {
    const parser = new SlashCommandParser();
    const ac = new AutoComplete(
        textarea,
        () => ac.text[0] == '/',
        async(text, index) => await parser.getNameAt(text, index),
        isFloating,
    );

    //TODO remove macro demo
    {
        const macroList = [
            ['pipe', 'only for slash command batching. Replaced with the returned result of the previous command.'],
            ['newline', 'just inserts a newline.'],
            ['trim', 'trims newlines surrounding this macro.'],
            ['noop', 'no operation, just an empty string.'],
            ['original', 'global prompts defined in API settings. Only valid in Advanced Definitions prompt overrides.'],
            ['input', 'the user input'],
            ['charPrompt', 'the Character\'s Main Prompt override'],
            ['charJailbreak', 'the Character\'s Jailbreak Prompt override'],
            ['description', 'the Character\'s Description'],
            ['personality', 'the Character\'s Personality'],
            ['scenario', 'the Character\'s Scenario'],
            ['persona', 'your current Persona Description'],
            ['mesExamples', 'the Character\'s Dialogue Examples'],
            ['mesExamplesRaw', 'unformatted Dialogue Examples (only for Story String)'],
            ['user', 'your current Persona username'],
            ['char', 'the Character\'s name'],
            ['group', 'a comma-separated list of group member names or the character name in solo chats. Alias: {{charIfNotGroup}}'],
            ['model', 'a text generation model name for the currently selected API. Can be inaccurate!'],
            ['lastMessage', 'the text of the latest chat message.'],
            ['lastMessageId', 'index # of the latest chat message. Useful for slash command batching.'],
            ['firstIncludedMessageId', 'the ID of the first message included in the context. Requires generation to be ran at least once in the current session.'],
            ['currentSwipeId', 'the 1-based ID of the current swipe in the last chat message. Empty string if the last message is user or prompt-hidden.'],
            ['lastSwipeId', 'the number of swipes in the last chat message. Empty string if the last message is user or prompt-hidden.'],
            ['// (note)', 'you can leave a note here, and the macro will be replaced with blank content. Not visible for the AI.'],
            ['time', 'the current time'],
            ['date', 'the current date'],
            ['weekday', 'the current weekday'],
            ['isotime', 'the current ISO time (24-hour clock)'],
            ['isodate', 'the current ISO date (YYYY-MM-DD)'],
            ['datetimeformat …', 'the current date/time in the specified format, e. g. for German date/time: {{datetimeformat DD.MM.YYYY HH:mm}}'],
            ['datetimeformat DD.MM.YYYY HH', 'the current date/time in the specified format, e. g. for German date/time: '],
            ['time_UTC±#', 'the current time in the specified UTC time zone offset, e.g. UTC-4 or UTC+2'],
            ['idle_duration', 'the time since the last user message was sent'],
            ['bias "text here"', 'sets a behavioral bias for the AI until the next user input. Quotes around the text are important.'],
            ['roll', 'rolls a dice. (ex: >{{roll:1d6}} will roll a 6-sided dice and return a number between 1 and 6)'],
            ['roll', 'rolls a dice. (ex:  will roll a 6-sided dice and return a number between 1 and 6)'],
            ['random', 'returns a random item from the list. (ex: {{random:1,2,3,4}} will return 1 of the 4 numbers at random. Works with text lists too.'],
            ['random', 'returns a random item from the list. (ex:  will return 1 of the 4 numbers at random. Works with text lists too.'],
            ['random', 'alternative syntax for random that allows to use commas in the list items.'],
            ['pick', 'picks a random item from the list. Works the same as {{random}}, with the same possible syntax options, but the pick will stay consistent for this chat once picked and won\'t be re-rolled on consecutive messages and prompt processing.'],
            ['banned "text here"', 'dynamically add text in the quotes to banned words sequences, if Text Generation WebUI backend used. Do nothing for others backends. Can be used anywhere (Character description, WI, AN, etc.) Quotes around the text are important.'],
            ['maxPrompt', 'max allowed prompt length in tokens = (context size - response length)'],
            ['exampleSeparator', 'context template example dialogues separator'],
            ['chatStart', 'context template chat start line'],
            ['systemPrompt', 'main system prompt (either character prompt override if chosen, or instructSystemPrompt)'],
            ['instructSystemPrompt', 'instruct system prompt'],
            ['instructSystemPromptPrefix', 'instruct system prompt prefix sequence'],
            ['instructSystemPromptSuffix', 'instruct system prompt suffix sequence'],
            ['instructUserPrefix', 'instruct user prefix sequence'],
            ['instructUserSuffix', 'instruct user suffix sequence'],
            ['instructAssistantPrefix', 'instruct assistant prefix sequence'],
            ['instructAssistantSuffix', 'instruct assistant suffix sequence'],
            ['instructFirstAssistantPrefix', 'instruct assistant first output sequence'],
            ['instructLastAssistantPrefix', 'instruct assistant last output sequence'],
            ['instructSystemPrefix', 'instruct system message prefix sequence'],
            ['instructSystemSuffix', 'instruct system message suffix sequence'],
            ['instructSystemInstructionPrefix', 'instruct system instruction prefix'],
            ['instructUserFiller', 'instruct first user message filler'],
            ['instructStop', 'instruct stop sequence'],
            ['getvar', 'replaced with the value of the local variable "name"'],
            ['setvar', 'replaced with empty string, sets the local variable "name" to "value"'],
            ['addvar', 'replaced with empty strings, adds a numeric value of "increment" to the local variable "name"'],
            ['incvar', 'replaced with the result of the increment of value of the variable "name" by 1'],
            ['decvar', 'replaced with the result of the decrement of value of the variable "name" by 1'],
            ['getglobalvar', 'replaced with the value of the global variable "name"'],
            ['setglobalvar', 'replaced with empty string, sets the global variable "name" to "value"'],
            ['addglobalvar', 'replaced with empty string, adds a numeric value of "increment" to the global variable "name"'],
            ['incglobalvar', 'replaced with the result of the increment of value of the global variable "name" by 1'],
            ['decglobalvar', 'replaced with the result of the decrement of value of the global variable "name" by 1'],
            ['var', 'replaced with the value of the scoped variable "name"'],
            ['var', 'replaced with the value of item at index (for arrays / lists or objects / dictionaries) of the scoped variable "name"'],
        ];
        class MacroOption extends AutoCompleteOption {
            item;
            constructor(item) {
                super(item[0], item[0]);
                this.item = item;
            }
            renderItem() {
                let li;
                li = this.makeItem(this.name, '{}', true, [], [], null, this.item[1]);
                li.setAttribute('data-name', this.name);
                return li;
            }
            renderDetails() {
                const frag = document.createDocumentFragment();
                const specs = document.createElement('div'); {
                    specs.classList.add('specs');
                    const name = document.createElement('div'); {
                        name.classList.add('name');
                        name.classList.add('monospace');
                        name.textContent = this.value.toString();
                        specs.append(name);
                    }
                    frag.append(specs);
                }
                const help = document.createElement('span'); {
                    help.classList.add('help');
                    help.textContent = this.item[1];
                    frag.append(help);
                }
                return frag;
            }
        }
        const options = macroList.map(m=>new MacroOption(m));
        let text;
        const stack = [];
        let macroIndex = [];
        const mac = new AutoComplete(
            textarea,
            ()=> mac.text[0] != '/',
            async(newText, index) => {
                if (text != newText) {
                    while (stack.pop());
                    while (macroIndex.pop());
                    text = newText;
                    let remaining = text;
                    let idx = remaining.search(/{{|}}/);
                    while (idx > -1) {
                        const symbol = remaining.slice(idx, idx + 2);
                        remaining = remaining.slice(idx + 2);
                        if (symbol == '{{') {
                            const item = {
                                name: /\w+/.exec(remaining)?.[0] ?? '',
                                start: idx + 2,
                                end: null,
                            };
                            macroIndex.push(item);
                            stack.push(item);
                        } else {
                            const item = stack.pop();
                            if (item) {
                                item.end = idx;
                            }
                        }
                        idx = remaining.search(/{{|}}/);
                    }
                }
                const executor = macroIndex.filter(it=>it.start <= index && (it.end >= index || it.end == null))
                    .slice(-1)[0]
                    ?? null
                ;
                if (executor) {
                    const result = new AutoCompleteNameResult(
                        executor.name,
                        executor.start,
                        options,
                        false,
                        ()=>`No matching macros for "{{${result.name}}}"`,
                        ()=>'No macros found!',
                    );
                    return result;
                }
                return null;
            },
            isFloating,
        );
    }
}
/**@type {HTMLTextAreaElement} */
const sendTextarea = document.querySelector('#send_textarea');
setSlashCommandAutoComplete(sendTextarea);
sendTextarea.addEventListener('input', () => {
    if (sendTextarea.value[0] == '/') {
        sendTextarea.style.fontFamily = 'monospace';
    } else {
        sendTextarea.style.fontFamily = null;
    }
});
