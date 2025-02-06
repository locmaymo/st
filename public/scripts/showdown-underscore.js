// Showdown extension that replaces words surrounded by singular underscores with <em> tags
export const markdownUnderscoreExt = () => {
    try {
        if (!canUseNegativeLookbehind()) {
            console.log('Showdown-underscore extension: Negative lookbehind not supported. Skipping.');
            return [];
        }

        return [{
            type: 'output',
            regex: new RegExp('(<code(?:\\s+[^>]*)?>[\\s\\S]*?<\\/code>)|\\b(?<!_)_(?!_)(.*?)(?<!_)_(?!_)\\b', 'g'),
            replace: function(match, codeContent, italicContent) {
                if (codeContent) {
                    // If it's inside <code> tags, return unchanged
                    return match;
                } else if (italicContent) {
                    // If it's an italic group, apply the replacement
                    return '<em>' + italicContent + '</em>';
                }
                // If none of the conditions are met, return the original match
                return match;
            },
        }];
    } catch (e) {
        console.error('Error in Showdown-underscore extension:', e);
        return [];
    }
};

function canUseNegativeLookbehind() {
    try {
        new RegExp('(?<!_)');
        return true;
    } catch (e) {
        return false;
    }
}
