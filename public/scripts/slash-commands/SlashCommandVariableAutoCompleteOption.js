import { AutoCompleteOption } from '../autocomplete/AutoCompleteOption.js';

export class SlashCommandVariableAutoCompleteOption extends AutoCompleteOption {
    /**
     * @param {string} name
     */
    constructor(name) {
        super(name);
    }


    renderItem() {
        let li;
        li = this.makeItem(this.name, '𝑥', true);
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
                name.textContent = this.name;
                specs.append(name);
            }
            frag.append(specs);
        }
        const help = document.createElement('span'); {
            help.classList.add('help');
            help.textContent = 'scoped variable';
            frag.append(help);
        }
        return frag;
    }
}
