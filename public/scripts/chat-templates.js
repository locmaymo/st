// the hash can be obtained from command line e.g. via: MODEL=path_to_model; python -c "import json, hashlib, sys; print(hashlib.sha256(json.load(open('"$MODEL"/tokenizer_config.json'))['chat_template'].encode()).hexdigest())"
// note that chat templates must be trimmed to match the llama.cpp metadata value
const hash_derivations = {
    // Meta
    'e10ca381b1ccc5cf9db52e371f3b6651576caee0a630b452e2816b2d404d4b65':
        // Meta-Llama-3.1-8B-Instruct
        // Meta-Llama-3.1-70B-Instruct
        'Llama 3 Instruct'
    ,
    '5816fce10444e03c2e9ee1ef8a4a1ea61ae7e69e438613f3b17b69d0426223a4':
        // Llama-3.2-1B-Instruct
        // Llama-3.2-3B-Instruct
        'Llama 3 Instruct'
    ,
    '73e87b1667d87ab7d7b579107f01151b29ce7f3ccdd1018fdc397e78be76219d':
        // Nemotron 70B
        'Llama 3 Instruct'
    ,

    // Mistral
    // Mistral Reference: https://github.com/mistralai/mistral-common
    'e16746b40344d6c5b5265988e0328a0bf7277be86f1c335156eae07e29c82826':
        // Mistral-Small-Instruct-2409
        // Mistral-Large-Instruct-2407
        'Mistral V2 & V3'
    ,
    '3c4ad5fa60dd8c7ccdf82fa4225864c903e107728fcaf859fa6052cb80c92ee9':
        // Mistral-Large-Instruct-2411
        'Mistral V7' // https://huggingface.co/mistralai/Mistral-Large-Instruct-2411
    ,
    'e4676cb56dffea7782fd3e2b577cfaf1e123537e6ef49b3ec7caa6c095c62272':
        // Mistral-Nemo-Instruct-2407
        'Mistral V3-Tekken'
    ,
    '26a59556925c987317ce5291811ba3b7f32ec4c647c400c6cc7e3a9993007ba7':
        // Mistral-7B-Instruct-v0.3
        'Mistral V2 & V3'
    ,

    // Gemma
    'ecd6ae513fe103f0eb62e8ab5bfa8d0fe45c1074fa398b089c93a7e70c15cfd6':
        // gemma-2-9b-it
        // gemma-2-27b-it
        'Gemma 2'
    ,
    '87fa45af6cdc3d6a9e4dd34a0a6848eceaa73a35dcfe976bd2946a5822a38bf3':
        // gemma-2-2b-it
        'Gemma 2'
    ,

    // Cohere
    '3b54f5c219ae1caa5c0bb2cdc7c001863ca6807cf888e4240e8739fa7eb9e02e':
        // command-r-08-2024
        'Command R'
    ,

    // Tulu
    'ac7498a36a719da630e99d48e6ebc4409de85a77556c2b6159eeb735bcbd11df':
        // Tulu-3-8B
        // Tulu-3-70B
        'Tulu'
};

const substr_derivations = {
    '<|im_start|>': 'ChatML', // qwen2.5, ...
};

const parse_derivation = derivation => (typeof derivation === 'string') ? {
    'context': derivation,
    'instruct': derivation,
} : derivation;

export async function deriveTemplatesFromChatTemplate(chat_template, hash) {
    if (chat_template.trim() === '') {
        console.log('Missing chat template.');
        return null;
    }

    if (hash in hash_derivations) {
        return parse_derivation(hash_derivations[hash]);
    }

    // heuristics
    for (const [substr, derivation] of Object.entries(substr_derivations) ) {
        if (chat_template.includes(substr)) {
            return parse_derivation(derivation);
        }
    }

    console.log(`Unknown chat template hash: ${hash} for [${chat_template}]`);
    return null;
}
