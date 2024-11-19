// https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
async function digestMessage(message) {
    const msgUint8 = new TextEncoder().encode(message); // encode as (utf-8) Uint8Array
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8); // hash the message
    const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
    const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''); // convert bytes to hex string
    return hashHex;
}

// the hash can be obtained from command line e.g. via: MODEL=path_to_model; python -c "import json, hashlib, sys; print(hashlib.sha256(json.load(open('"$MODEL"/tokenizer_config.json'))['chat_template'].strip().encode()).hexdigest())"
// note that chat templates must be trimmed to match the llama.cpp metadata value
const derivations = {
    // Meta
    '93c0e9aa3629bbd77e68dbc0f5621f6e6b23aa8d74b932595cdb8d64684526d7': {
        // Meta-Llama-3.1-8B-Instruct
        // Meta-Llama-3.1-70B-Instruct
        context: 'Llama 3 Instruct',
        instruct: 'Llama 3 Instruct',
    },
    'd82792f95932f1c9cef5c4bd992f171225e3bf8c7b609b4557c9e1ec96be819f': {
        // Llama-3.2-1B-Instruct
        // Llama-3.2-3B-Instruct
        context: 'Llama 3 Instruct',
        instruct: 'Llama 3 Instruct',
    },

    // Mistral
    // Mistral Reference: https://github.com/mistralai/mistral-common
    'cafb64e0e9e5fd2503054b3479593fae39cbdfd52338ce8af9bb4664a8eb05bd': {
        // Mistral-Small-Instruct-2409
        // Mistral-Large-Instruct-2407
        context: 'Mistral V2 & V3',
        instruct: 'Mistral V2 & V3',
    },
    '3c4ad5fa60dd8c7ccdf82fa4225864c903e107728fcaf859fa6052cb80c92ee9': {
        // Mistral-Large-Instruct-2411
        context: 'Mistral V7', // https://huggingface.co/mistralai/Mistral-Large-Instruct-2411
        instruct: 'Mistral V7',
    },
    'e7deee034838db2bfc7487788a3013d8a307ab69f72f3c54a85f06fd76007d4e': {
        // Mistral-Nemo-Instruct-2407
        context: 'Mistral V3-Tekken',
        instruct: 'Mistral V3-Tekken',
    },
    '26a59556925c987317ce5291811ba3b7f32ec4c647c400c6cc7e3a9993007ba7': {
        // Mistral-7B-Instruct-v0.3
        context: 'Mistral V2 & V3',
        instruct: 'Mistral V2 & V3',
    },

    // Gemma
    'ecd6ae513fe103f0eb62e8ab5bfa8d0fe45c1074fa398b089c93a7e70c15cfd6': {
        // gemma-2-9b-it
        // gemma-2-27b-it
        context: 'Gemma 2',
        instruct: 'Gemma 2',
    },

    // Cohere
    '3b54f5c219ae1caa5c0bb2cdc7c001863ca6807cf888e4240e8739fa7eb9e02e': {
        // command-r-08-2024
        context: 'Command R',
        instruct: 'Command R',
    },
};

export async function deriveTemplatesFromChatTemplate(chat_template) {
    const hash = await digestMessage(chat_template);
    if (hash in derivations) {
        return derivations[hash];
    }
    console.log(`Unknown chat template hash: ${hash}`);
    return null;
}
