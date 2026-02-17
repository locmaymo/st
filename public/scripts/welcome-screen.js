import {
    addOneMessage,
    characters,
    chat,
    deleteCharacterChatByName,
    displayVersion,
    doNewChat,
    event_types,
    eventSource,
    getCharacters,
    getCurrentChatId,
    getRequestHeaders,
    getSystemMessageByType,
    getThumbnailUrl,
    is_send_press,
    neutralCharacterName,
    newAssistantChat,
    openCharacterChat,
    printCharactersDebounced,
    renameGroupOrCharacterChat,
    saveSettingsDebounced,
    selectCharacterById,
    setActiveCharacter,
    setActiveGroup,
    system_avatar,
    system_message_types,
    this_chid,
    unshallowCharacter,
    updateRemoteChatName,
} from '../script.js';
import { getRegexedString, regex_placement } from './extensions/regex/engine.js';
import { deleteGroupChatByName, getGroupAvatar, groups, is_group_generating, openGroupById, openGroupChat } from './group-chats.js';
import { t } from './i18n.js';
import { callGenericPopup, POPUP_TYPE } from './popup.js';
import { getMessageTimeStamp } from './RossAscends-mods.js';
import { renderTemplateAsync } from './templates.js';
import { accountStorage } from './util/AccountStorage.js';
import { flashHighlight, isElementInViewport, sortMoments, timestampToMoment } from './utils.js';

const assistantAvatarKey = 'assistant';
const pinnedChatsKey = 'pinnedChats';
const defaultAssistantAvatar = 'default_Assistant.png';

const DEFAULT_DISPLAYED = 3;
const MAX_DISPLAYED = 15;

/**
 * @typedef {Pick<RecentChat, 'group' | 'avatar' | 'file_name'>} PinnedChat
 */

/**
 * Manages pinned chat storage and operations.
 */
class PinnedChatsManager {
    /** @type {Record<string, PinnedChat> | null} */
    static #cachedState = null;

    /**
     * Initializes the cached state from storage.
     * Should be called once on app init.
     */
    static init() {
        this.#cachedState = this.#loadFromStorage();
    }

    /**
     * Loads state from storage.
     * @returns {Record<string, PinnedChat>}
     */
    static #loadFromStorage() {
        const pinnedState = /** @type {Record<string, PinnedChat>} */ ({});
        const value = accountStorage.getItem(pinnedChatsKey);
        if (value) {
            try {
                Object.assign(pinnedState, JSON.parse(value));
            } catch (error) {
                console.warn('Failed to parse pinned chats from storage.', error);
            }
        }
        return pinnedState;
    }

    /**
     * Generates a key for pinned chat storage.
     * @param {RecentChat} recentChat Recent chat data
     * @returns {string} Key for pinned chat storage
     */
    static getKey(recentChat) {
        return `${recentChat.group ? 'group_' + recentChat.group : ''}${recentChat.avatar ? 'char_' + recentChat.avatar : ''}_${recentChat.file_name}`;
    }

    /**
     * Gets the pinned chat state from cache.
     * @returns {Record<string, PinnedChat>}
     */
    static getState() {
        if (this.#cachedState === null) {
            this.#cachedState = this.#loadFromStorage();
        }
        return this.#cachedState;
    }

    /**
     * Saves the pinned chat state to storage and updates cache.
     * @param {Record<string, PinnedChat>} state The state to save
     */
    static #saveState(state) {
        this.#cachedState = state;
        accountStorage.setItem(pinnedChatsKey, JSON.stringify(state));
    }

    /**
     * Checks if a chat is pinned.
     * @param {RecentChat} recentChat Recent chat data
     * @returns {boolean} True if the chat is pinned, false otherwise
     */
    static isPinned(recentChat) {
        const pinKey = this.getKey(recentChat);
        const pinState = this.getState();
        return pinKey in pinState;
    }

    /**
     * Toggles the pinned state of a chat.
     * @param {RecentChat} recentChat Recent chat data
     * @param {boolean} pinned New pinned state
     */
    static toggle(recentChat, pinned) {
        const pinKey = this.getKey(recentChat);
        const pinState = { ...this.getState() };
        if (pinned) {
            pinState[pinKey] = {
                group: recentChat.group,
                avatar: recentChat.avatar,
                file_name: recentChat.file_name,
            };
        } else {
            delete pinState[pinKey];
        }
        this.#saveState(pinState);
    }

    /**
     * Gets all pinned chats.
     * @returns {PinnedChat[]}
     */
    static getAll() {
        const pinState = this.getState();
        return Object.values(pinState);
    }
}

export function getPermanentAssistantAvatar() {
    const assistantAvatar = accountStorage.getItem(assistantAvatarKey);
    if (assistantAvatar === null) {
        return defaultAssistantAvatar;
    }

    const character = characters.find(x => x.avatar === assistantAvatar);
    if (character === undefined) {
        accountStorage.removeItem(assistantAvatarKey);
        return defaultAssistantAvatar;
    }

    return assistantAvatar;
}

/**
 * Opens a welcome screen if no chat is currently active.
 * @param {object} param Additional parameters
 * @param {boolean} [param.force] If true, forces clearing of the welcome screen.
 * @param {boolean} [param.expand] If true, expands the recent chats section.
 * @returns {Promise<void>}
 */
export async function openWelcomeScreen({ force = false, expand = false } = {}) {
    const currentChatId = getCurrentChatId();
    if (currentChatId !== undefined || (chat.length > 0 && !force)) {
        return;
    }

    const recentChats = await getRecentChats();
    const chatAfterFetch = getCurrentChatId();
    if (chatAfterFetch !== currentChatId) {
        console.debug('Chat changed while fetching recent chats.');
        return;
    }

    if (chatAfterFetch === undefined && force) {
        console.debug('Forcing welcome screen open.');
        chat.splice(0, chat.length);
        $('#chat').empty();
    }

    await sendWelcomePanel(recentChats, expand);
    await unshallowPermanentAssistant();
    sendWelcomePrompt();
    await checkAndDisplayUpdate();
    await fetchAndRenderRemoteContent();
    sendAssistantMessage();
}

/**
 * Kiểm tra phiên bản mới trên GitHub và hiện thông báo nhỏ
 */
async function checkAndDisplayUpdate() {
    const chatElement = document.getElementById('chat');
    if (!chatElement) return;

    try {
        const ghRes = await fetch(`https://api.github.com/repos/locmaymo/st/releases/latest`);
        if (!ghRes.ok) return;

        const ghData = await ghRes.json();

        // 1. Xử lý Version GitHub (Xóa chữ 'v' ở đầu nếu có) -> 1.13.4
        const remoteVer = ghData.tag_name.replace(/^v/, '').trim();

        // 2. Xử lý Version Local (Dùng Regex gắp cụm số X.Y.Z ra)
        // Tìm chuỗi dạng: số.số.số (Ví dụ: 1.13.4)
        const versionRegex = /(\d+\.\d+\.\d+)/;
        const match = displayVersion.match(versionRegex);

        // Nếu tìm thấy số thì lấy, không thì để nguyên
        const localVer = match ? match[0] : displayVersion.replace(/^v/, '');

        // Debug để kiểm tra (Bạn có thể F12 để xem nó gắp đúng chưa)
        console.log(`[Update Check] Remote: ${remoteVer} | Local: ${localVer}`);

        // 3. So sánh
        if (remoteVer !== localVer) {
            // Tạo thanh thông báo (Banner)
            const updateBanner = document.createElement('div');
            updateBanner.className = 'update-notification-banner';

            updateBanner.style.cssText = `
                width: 100%;
                max-width: 800px;
                margin: 10px auto 0 auto;
                padding: 10px 15px;
                background: linear-gradient(90deg, rgba(78, 115, 223, 0.15), rgba(28, 200, 138, 0.15));
                border: 1px solid #1CC88A;
                border-radius: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                color: #eee;
                font-size: 0.9rem;
                box-sizing: border-box;
            `;

            updateBanner.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="background: #1CC88A; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; justify-content: center; align-items: center; font-size: 12px;">
                        <i class="fa-solid fa-arrow-up"></i>
                    </div>
                    <div>
                        <span style="font-weight: bold; color: #1CC88A;">Cập nhật mới: v${remoteVer}</span>
                        <span style="color: #888; font-size: 12px; margin-left: 5px;">(Hiện tại: v${localVer})</span>
                    </div>
                </div>
                <a href="${ghData.html_url}" target="_blank" style="
                    background: #4E73DF; color: white; padding: 5px 12px;
                    text-decoration: none; border-radius: 4px; font-size: 12px; font-weight: bold;
                    transition: 0.2s;
                ">
                    Xem & Tải
                </a>
            `;

            chatElement.appendChild(updateBanner);
        }
    } catch (e) {
        console.warn("GitHub Update Check Error:", e);
    }
}

// Helper: Tự động tách ID Youtube dù người dùng nhập Link hay ID
function getYoutubeId(urlOrId) {
    if (!urlOrId) return null;
    // Nếu chuỗi ngắn (dưới 15 ký tự) thì coi như là ID luôn
    if (urlOrId.length < 15) return urlOrId;

    // Nếu là link, dùng Regex để tách ID
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = urlOrId.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

/**
 * Tải nội dung từ xa và hiển thị đúng style cũ
 */
async function fetchAndRenderRemoteContent() {
    const chatElement = document.getElementById('chat');
    if (!chatElement) return;

    try {
        const REMOTE_NEWS_URL = 'https://raw.githubusercontent.com/locmaymo/json/main/stRemoteContent.json';
        // 1. Tải config (Nhớ thay REMOTE_NEWS_URL bằng link raw json của bạn)
        const response = await fetch(REMOTE_NEWS_URL, { cache: "no-store" });
        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.json();

        // Nếu không muốn hiện hoặc không có dữ liệu thì thôi
        if (!data.show && !data.youtubeId && !data.messageHTML) return;

        // 2. Tạo Container (Style Y HỆT code cũ của bạn)
        const youtubeContainer = document.createElement('div');
        youtubeContainer.className = 'youtube-embed-container';
        youtubeContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            margin: 20px 0;
            padding: 20px;
            background-color: var(--SmartThemeBotMesBlurTintColor);
            border: 1px solid var(--SmartThemeBorderColor);
            border-radius: 10px;
            position: relative;
            width: 100%;
            max-width: 800px;
            margin-left: auto;
            margin-right: auto;
        `;

        // 3. Nếu có thông báo chữ (HTML) thì hiện lên trên video
        if (data.messageHTML) {
            const msgDiv = document.createElement('div');
            msgDiv.innerHTML = data.messageHTML;
            msgDiv.style.cssText = `
                width: 100%;
                margin-bottom: 15px;
                color: var(--SmartThemeBodyColor);
                font-size: 1rem;
                line-height: 1.5;
                text-align: left;
            `;
            // Style cho link trong thông báo
            const links = msgDiv.getElementsByTagName('a');
            for (let link of links) {
                link.style.color = '#4E73DF';
                link.style.fontWeight = 'bold';
                link.target = '_blank';
            }
            youtubeContainer.appendChild(msgDiv);
        }

        // 4. Xử lý Video Youtube
        const videoId = getYoutubeId(data.youtubeId);

        if (videoId) {
            // Wrapper giữ tỉ lệ 16:9
            const iframeWrapper = document.createElement('div');
            iframeWrapper.style.cssText = `
                position: relative;
                width: 100%;
                height: 0;
                padding-bottom: 56.25%; /* 16:9 */
                overflow: hidden;
                border-radius: 8px;
            `;

            const iframe = document.createElement('iframe');
            // Tạo link embed chuẩn
            iframe.src = `https://www.youtube.com/embed/${videoId}`;
            iframe.title = 'Remote Content';
            iframe.frameBorder = '0';

            // Các thuộc tính quan trọng để tránh lỗi 153
            iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
            iframe.referrerPolicy = 'strict-origin-when-cross-origin'; // Quan trọng
            iframe.allowFullscreen = true;

            iframe.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                border-radius: 8px;
            `;

            iframeWrapper.appendChild(iframe);
            youtubeContainer.appendChild(iframeWrapper);
        }

        // Chèn vào giao diện
        chatElement.appendChild(youtubeContainer);

    } catch (error) {
        console.warn('Could not fetch remote content:', error);
    }
}

/**
 * Makes sure the assistant character has all data loaded.
 * @returns {Promise<void>}
 */
async function unshallowPermanentAssistant() {
    const assistantAvatar = getPermanentAssistantAvatar();
    const characterId = characters.findIndex(x => x.avatar === assistantAvatar);
    if (characterId === -1) {
        return;
    }

    await unshallowCharacter(String(characterId));
}

/**
 * Returns a greeting message for the assistant based on the character.
 * @param {Character} character Character data
 * @returns {string} Greeting message
*/
function getAssistantGreeting(character) {
    const defaultGreeting = t`If you're connected to an API, try asking me something!` + '\n***\n' + t`**Hint:** Set any character as your welcome page assistant from their "More..." menu.`;

    if (!character) {
        return defaultGreeting;
    }

    return getRegexedString(character.first_mes || '', regex_placement.AI_OUTPUT, { depth: 0 }) || defaultGreeting;
}

function sendAssistantMessage() {
    const currentAssistantAvatar = getPermanentAssistantAvatar();
    const character = characters.find(x => x.avatar === currentAssistantAvatar);
    const name = character ? character.name : neutralCharacterName;
    const avatar = character ? getThumbnailUrl('avatar', character.avatar) : system_avatar;
    const greeting = getAssistantGreeting(character);

    const message = {
        name: name,
        force_avatar: avatar,
        mes: greeting,
        is_system: false,
        is_user: false,
        send_date: getMessageTimeStamp(),
        extra: {
            type: system_message_types.ASSISTANT_MESSAGE,
            swipeable: false,
        },
    };

    chat.push(message);
    addOneMessage(message, { scroll: false });
}

function sendWelcomePrompt() {
    const message = getSystemMessageByType(system_message_types.WELCOME_PROMPT);
    chat.push(message);
    addOneMessage(message, { scroll: false });
}

/**
 * Sends the welcome panel to the chat.
 * @param {RecentChat[]} chats List of recent chats
 * @param {boolean} [expand=false] If true, expands the recent chats section
 */
async function sendWelcomePanel(chats, expand = false) {
    try {
        const chatElement = document.getElementById('chat');
        const sendTextArea = document.getElementById('send_textarea');
        if (!chatElement) {
            console.error('Chat element not found');
            return;
        }
        const templateData = {
            chats,
            empty: !chats.length,
            version: displayVersion,
            more: chats.some(chat => chat.hidden),
        };
        const template = await renderTemplateAsync('welcomePanel', templateData);
        const fragment = document.createRange().createContextualFragment(template);
        fragment.querySelectorAll('.welcomePanel').forEach((root) => {
            const recentHiddenClass = 'recentHidden';
            const recentHiddenKey = 'WelcomePage_RecentChatsHidden';
            if (accountStorage.getItem(recentHiddenKey) === 'true') {
                root.classList.add(recentHiddenClass);
            }
            root.querySelectorAll('.showRecentChats').forEach((button) => {
                button.addEventListener('click', () => {
                    root.classList.remove(recentHiddenClass);
                    accountStorage.setItem(recentHiddenKey, 'false');
                });
            });
            root.querySelectorAll('.hideRecentChats').forEach((button) => {
                button.addEventListener('click', () => {
                    root.classList.add(recentHiddenClass);
                    accountStorage.setItem(recentHiddenKey, 'true');
                });
            });
        });
        fragment.querySelectorAll('.recentChat').forEach((item) => {
            item.addEventListener('click', () => {
                const avatarId = item.getAttribute('data-avatar');
                const groupId = item.getAttribute('data-group');
                const fileName = item.getAttribute('data-file');
                if (avatarId && fileName) {
                    void openRecentCharacterChat(avatarId, fileName);
                }
                if (groupId && fileName) {
                    void openRecentGroupChat(groupId, fileName);
                }
            });
        });
        const hiddenChats = fragment.querySelectorAll('.recentChat.hidden');
        fragment.querySelectorAll('button.showMoreChats').forEach((button) => {
            const showRecentChatsTitle = t`Show more recent chats`;
            const hideRecentChatsTitle = t`Show less recent chats`;

            button.setAttribute('title', showRecentChatsTitle);
            button.addEventListener('click', () => {
                const rotate = button.classList.contains('rotated');
                hiddenChats.forEach((chatItem) => {
                    chatItem.classList.toggle('hidden', rotate);
                });
                button.classList.toggle('rotated', !rotate);
                button.setAttribute('title', rotate ? showRecentChatsTitle : hideRecentChatsTitle);
            });
        });
        fragment.querySelectorAll('button.openTemporaryChat').forEach((button) => {
            button.addEventListener('click', async () => {
                await newAssistantChat({ temporary: true });
                if (sendTextArea instanceof HTMLTextAreaElement) {
                    sendTextArea.focus();
                }
            });
        });
        fragment.querySelectorAll('.recentChat.group').forEach((groupChat) => {
            const groupId = groupChat.getAttribute('data-group');
            const group = groups.find(x => x.id === groupId);
            if (group) {
                const avatar = groupChat.querySelector('.avatar');
                if (!avatar) {
                    return;
                }
                const groupAvatar = getGroupAvatar(group);
                $(avatar).replaceWith(groupAvatar);
            }
        });
        fragment.querySelectorAll('.recentChat .renameChat').forEach((renameButton) => {
            renameButton.addEventListener('click', (event) => {
                event.stopPropagation();
                const chatItem = renameButton.closest('.recentChat');
                if (!chatItem) {
                    return;
                }
                const avatarId = chatItem.getAttribute('data-avatar');
                const groupId = chatItem.getAttribute('data-group');
                const fileName = chatItem.getAttribute('data-file');
                if (avatarId && fileName) {
                    void renameRecentCharacterChat(avatarId, fileName);
                }
                if (groupId && fileName) {
                    void renameRecentGroupChat(groupId, fileName);
                }
            });
        });
        fragment.querySelectorAll('.recentChat .deleteChat').forEach((deleteButton) => {
            deleteButton.addEventListener('click', (event) => {
                event.stopPropagation();
                const chatItem = deleteButton.closest('.recentChat');
                if (!chatItem) {
                    return;
                }
                const avatarId = chatItem.getAttribute('data-avatar');
                const groupId = chatItem.getAttribute('data-group');
                const fileName = chatItem.getAttribute('data-file');
                if (avatarId && fileName) {
                    void deleteRecentCharacterChat(avatarId, fileName);
                }
                if (groupId && fileName) {
                    void deleteRecentGroupChat(groupId, fileName);
                }
            });
        });
        fragment.querySelectorAll('.recentChat .pinChat').forEach((pinButton) => {
            pinButton.addEventListener('click', async (event) => {
                event.stopPropagation();
                const chatItem = pinButton.closest('.recentChat');
                if (!chatItem) {
                    return;
                }
                const avatarId = chatItem.getAttribute('data-avatar');
                const groupId = chatItem.getAttribute('data-group');
                const fileName = chatItem.getAttribute('data-file');
                const recentChat = chats.find(c => c.chat_name === fileName && ((c.is_group && c.group === groupId) || (!c.is_group && c.avatar === avatarId)));
                if (!recentChat) {
                    console.error('Recent chat not found for pinning.');
                    return;
                }
                const currentlyPinned = PinnedChatsManager.isPinned(recentChat);
                PinnedChatsManager.toggle(recentChat, !currentlyPinned);
                await refreshWelcomeScreen({ flashChat: recentChat });
            });
        });
        chatElement.append(fragment.firstChild);
        if (expand) {
            chatElement.querySelectorAll('button.showMoreChats').forEach((button) => {
                if (button instanceof HTMLButtonElement) {
                    button.click();
                }
            });
        }
    } catch (error) {
        console.error('Welcome screen error:', error);
    }
}

/**
 * Opens a recent character chat.
 * @param {string} avatarId Avatar file name
 * @param {string} fileName Chat file name
 */
async function openRecentCharacterChat(avatarId, fileName) {
    const characterId = characters.findIndex(x => x.avatar === avatarId);
    if (characterId === -1) {
        console.error(`Character not found for avatar ID: ${avatarId}`);
        return;
    }

    try {
        await selectCharacterById(characterId);
        setActiveCharacter(avatarId);
        saveSettingsDebounced();
        const currentChatId = getCurrentChatId();
        if (currentChatId === fileName) {
            console.debug(`Chat ${fileName} is already open.`);
            return;
        }
        await openCharacterChat(fileName);
    } catch (error) {
        console.error('Error opening recent chat:', error);
        toastr.error(t`Failed to open recent chat. See console for details.`);
    }
}

/**
 * Opens a recent group chat.
 * @param {string} groupId Group ID
 * @param {string} fileName Chat file name
 */
async function openRecentGroupChat(groupId, fileName) {
    const group = groups.find(x => x.id === groupId);
    if (!group) {
        console.error(`Group not found for ID: ${groupId}`);
        return;
    }

    try {
        await openGroupById(groupId);
        setActiveGroup(groupId);
        saveSettingsDebounced();
        const currentChatId = getCurrentChatId();
        if (currentChatId === fileName) {
            console.debug(`Chat ${fileName} is already open.`);
            return;
        }
        await openGroupChat(groupId, fileName);
    } catch (error) {
        console.error('Error opening recent group chat:', error);
        toastr.error(t`Failed to open recent group chat. See console for details.`);
    }
}

/**
 * Renames a recent character chat.
 * @param {string} avatarId Avatar file name
 * @param {string} fileName Chat file name
 */
async function renameRecentCharacterChat(avatarId, fileName) {
    const characterId = characters.findIndex(x => x.avatar === avatarId);
    if (characterId === -1) {
        console.error(`Character not found for avatar ID: ${avatarId}`);
        return;
    }
    try {
        const popupText = await renderTemplateAsync('chatRename');
        const newName = await callGenericPopup(popupText, POPUP_TYPE.INPUT, fileName);
        if (!newName || typeof newName !== 'string' || newName === fileName) {
            console.log('No new name provided, aborting');
            return;
        }
        await renameGroupOrCharacterChat({
            characterId: String(characterId),
            oldFileName: fileName,
            newFileName: newName,
            loader: false,
        });
        await updateRemoteChatName(characterId, newName);
        await refreshWelcomeScreen();
        toastr.success(t`Chat renamed.`);
    } catch (error) {
        console.error('Error renaming recent character chat:', error);
        toastr.error(t`Failed to rename recent chat. See console for details.`);
    }
}

/**
 * Renames a recent group chat.
 * @param {string} groupId Group ID
 * @param {string} fileName Chat file name
 */
async function renameRecentGroupChat(groupId, fileName) {
    const group = groups.find(x => x.id === groupId);
    if (!group) {
        console.error(`Group not found for ID: ${groupId}`);
        return;
    }
    try {
        const popupText = await renderTemplateAsync('chatRename');
        const newName = await callGenericPopup(popupText, POPUP_TYPE.INPUT, fileName);
        if (!newName || newName === fileName) {
            console.log('No new name provided, aborting');
            return;
        }
        await renameGroupOrCharacterChat({
            groupId: String(groupId),
            oldFileName: fileName,
            newFileName: String(newName),
            loader: false,
        });
        await refreshWelcomeScreen();
        toastr.success(t`Group chat renamed.`);
    } catch (error) {
        console.error('Error renaming recent group chat:', error);
        toastr.error(t`Failed to rename recent group chat. See console for details.`);
    }
}

/**
 * Deletes a recent character chat.
 * @param {string} avatarId Avatar file name
 * @param {string} fileName Chat file name
 */
async function deleteRecentCharacterChat(avatarId, fileName) {
    const characterId = characters.findIndex(x => x.avatar === avatarId);
    if (characterId === -1) {
        console.error(`Character not found for avatar ID: ${avatarId}`);
        return;
    }
    try {
        const confirm = await callGenericPopup(t`Delete the Chat File?`, POPUP_TYPE.CONFIRM);
        if (!confirm) {
            console.log('Deletion cancelled by user');
            return;
        }
        await deleteCharacterChatByName(String(characterId), fileName);
        await refreshWelcomeScreen();
        toastr.success(t`Chat deleted.`);
    } catch (error) {
        console.error('Error deleting recent character chat:', error);
        toastr.error(t`Failed to delete recent chat. See console for details.`);
    }
}

/**
 * Deletes a recent group chat.
 * @param {string} groupId Group ID
 * @param {string} fileName Chat file name
 */
async function deleteRecentGroupChat(groupId, fileName) {
    const group = groups.find(x => x.id === groupId);
    if (!group) {
        console.error(`Group not found for ID: ${groupId}`);
        return;
    }
    try {
        const confirm = await callGenericPopup(t`Delete the Chat File?`, POPUP_TYPE.CONFIRM);
        if (!confirm) {
            console.log('Deletion cancelled by user');
            return;
        }
        await deleteGroupChatByName(groupId, fileName);
        await refreshWelcomeScreen();
        toastr.success(t`Group chat deleted.`);
    } catch (error) {
        console.error('Error deleting recent group chat:', error);
        toastr.error(t`Failed to delete recent group chat. See console for details.`);
    }
}

/**
 * Reopens the welcome screen and restores the scroll position.
 * @param {object} param Additional parameters
 * @param {RecentChat} [param.flashChat] Recent chat to flash (if any)
 * @returns {Promise<void>}
 */
async function refreshWelcomeScreen({ flashChat = null } = {}) {
    const chatElement = document.getElementById('chat');
    if (!chatElement) {
        console.error('Chat element not found');
        return;
    }

    const scrollTop = chatElement.scrollTop;
    const scrollHeight = chatElement.scrollHeight;
    const expand = chatElement.querySelectorAll('button.showMoreChats.rotated').length > 0;

    await openWelcomeScreen({ force: true, expand });

    // Restore scroll position or flash specific chat
    if (flashChat) {
        const recentChats = Array.from(chatElement.querySelectorAll('.recentChat'));
        const chatToFlash = recentChats.find(el => {
            const file = el.getAttribute('data-file');
            const group = el.getAttribute('data-group');
            const avatar = el.getAttribute('data-avatar');
            return file === flashChat.chat_name &&
                ((flashChat.is_group && group === flashChat.group) || (!flashChat.is_group && avatar === flashChat.avatar));
        });
        if (chatToFlash instanceof HTMLElement) {
            if (!isElementInViewport(chatToFlash)) {
                chatElement.scrollTop = chatToFlash.offsetTop - chatElement.offsetTop - (chatToFlash.clientHeight / 2);
            }
            flashHighlight($(chatToFlash), 1000);
        }
    } else {
        // Restore scroll position
        chatElement.scrollTop = scrollTop + (chatElement.scrollHeight - scrollHeight);
    }
}

/**
 * Gets the list of recent chats from the server.
 * @returns {Promise<RecentChat[]>} List of recent chats
 *
 * @typedef {object} RecentChat
 * @property {string} file_name Name of the chat file
 * @property {string} chat_name Name of the chat (without extension)
 * @property {string} file_size Size of the chat file
 * @property {number} chat_items Number of items in the chat
 * @property {string} mes Last message content
 * @property {string} last_mes Timestamp of the last message
 * @property {string} avatar Avatar URL
 * @property {string} char_thumbnail Thumbnail URL
 * @property {string} char_name Character or group name
 * @property {string} date_short Date in short format
 * @property {string} date_long Date in long format
 * @property {string} group Group ID (if applicable)
 * @property {boolean} is_group Indicates if the chat is a group chat
 * @property {boolean} hidden Chat will be hidden by default
 * @property {boolean} pinned Indicates if the chat is pinned
 */
async function getRecentChats() {
    const response = await fetch('/api/chats/recent', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ max: MAX_DISPLAYED, pinned: PinnedChatsManager.getAll() }),
        cache: 'no-cache',
    });

    if (!response.ok) {
        console.warn('Failed to fetch recent character chats');
        return [];
    }

    /** @type {RecentChat[]} */
    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
        return [];
    }

    const dataWithEntities = data
        .map(chat => ({ chat, character: characters.find(x => x.avatar === chat.avatar), group: groups.find(x => x.id === chat.group) }))
        .filter(t => t.character || t.group)
        .sort((a, b) => {
            const isAPinned = PinnedChatsManager.isPinned(a.chat);
            const isBPinned = PinnedChatsManager.isPinned(b.chat);
            const momentComparison = sortMoments(timestampToMoment(a.chat.last_mes), timestampToMoment(b.chat.last_mes));

            if (isAPinned && !isBPinned) {
                return -1;
            }
            if (!isAPinned && isBPinned) {
                return 1;
            }

            return momentComparison;
        });

    dataWithEntities.forEach(({ chat, character, group }, index) => {
        const chatTimestamp = timestampToMoment(chat.last_mes);
        chat.char_name = character?.name || group?.name || '';
        chat.date_short = chatTimestamp.format('l');
        chat.date_long = chatTimestamp.format('LL LT');
        chat.chat_name = chat.file_name.replace('.jsonl', '');
        chat.char_thumbnail = character ? getThumbnailUrl('avatar', character.avatar) : system_avatar;
        chat.is_group = !!group;
        chat.hidden = index >= DEFAULT_DISPLAYED;
        chat.avatar = chat.avatar || '';
        chat.group = chat.group || '';
        chat.pinned = PinnedChatsManager.isPinned(chat);
    });

    return dataWithEntities.map(t => t.chat);
}

export async function openPermanentAssistantChat({ tryCreate = true, created = false } = {}) {
    const avatar = getPermanentAssistantAvatar();
    const characterId = characters.findIndex(x => x.avatar === avatar);
    if (characterId === -1) {
        if (!tryCreate) {
            console.error(`Character not found for avatar ID: ${avatar}. Cannot create.`);
            return;
        }

        try {
            console.log(`Character not found for avatar ID: ${avatar}. Creating new assistant.`);
            await createPermanentAssistant();
            return openPermanentAssistantChat({ tryCreate: false, created: true });
        }
        catch (error) {
            console.error('Error creating permanent assistant:', error);
            toastr.error(t`Failed to create ${neutralCharacterName}. See console for details.`);
            return;
        }
    }

    try {
        await selectCharacterById(characterId);
        if (!created) {
            await doNewChat({ deleteCurrentChat: false });
        }
        console.log(`Opened permanent assistant chat for ${neutralCharacterName}.`, getCurrentChatId());
    } catch (error) {
        console.error('Error opening permanent assistant chat:', error);
        toastr.error(t`Failed to open permanent assistant chat. See console for details.`);
    }
}

async function createPermanentAssistant() {
    if (is_group_generating || is_send_press) {
        throw new Error(t`Cannot create while generating.`);
    }

    const formData = new FormData();
    formData.append('ch_name', neutralCharacterName);
    formData.append('file_name', defaultAssistantAvatar.replace('.png', ''));
    formData.append('creator_notes', t`Automatically created character. Feel free to edit.`);

    try {
        const avatarResponse = await fetch(system_avatar);
        const avatarBlob = await avatarResponse.blob();
        formData.append('avatar', avatarBlob, defaultAssistantAvatar);
    } catch (error) {
        console.warn('Error fetching system avatar. Fallback image will be used.', error);
    }

    const fetchResult = await fetch('/api/characters/create', {
        method: 'POST',
        headers: getRequestHeaders({ omitContentType: true }),
        body: formData,
        cache: 'no-cache',
    });

    if (!fetchResult.ok) {
        throw new Error(t`Creation request did not succeed.`);
    }

    await getCharacters();
}

export async function openPermanentAssistantCard() {
    const avatar = getPermanentAssistantAvatar();
    const characterId = characters.findIndex(x => x.avatar === avatar);
    if (characterId === -1) {
        toastr.info(t`Assistant not found. Try sending a chat message.`);
        return;
    }

    await selectCharacterById(characterId);
}

/**
 * Assigns a character as the assistant.
 * @param {string?} characterId Character ID
 */
export function assignCharacterAsAssistant(characterId) {
    if (characterId === undefined) {
        return;
    }
    /** @type {Character} */
    const character = characters[characterId];
    if (!character) {
        return;
    }

    const currentAssistantAvatar = getPermanentAssistantAvatar();
    if (currentAssistantAvatar === character.avatar) {
        if (character.avatar === defaultAssistantAvatar) {
            toastr.info(t`${character.name} is a system assistant. Choose another character.`);
            return;
        }

        toastr.info(t`${character.name} is no longer your assistant.`);
        accountStorage.removeItem(assistantAvatarKey);
        return;
    }

    accountStorage.setItem(assistantAvatarKey, character.avatar);
    printCharactersDebounced();
    toastr.success(t`Set ${character.name} as your assistant.`);
}

export function initWelcomeScreen() {
    PinnedChatsManager.init();

    const events = [event_types.CHAT_CHANGED, event_types.APP_READY];
    for (const event of events) {
        eventSource.makeFirst(event, openWelcomeScreen);
    }

    eventSource.on(event_types.CHARACTER_MANAGEMENT_DROPDOWN, (target) => {
        if (target !== 'set_as_assistant') {
            return;
        }
        assignCharacterAsAssistant(this_chid);
    });

    eventSource.on(event_types.CHARACTER_RENAMED, (oldAvatar, newAvatar) => {
        if (oldAvatar === getPermanentAssistantAvatar()) {
            accountStorage.setItem(assistantAvatarKey, newAvatar);
        }
    });
}
