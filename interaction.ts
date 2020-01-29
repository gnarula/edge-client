import readline from 'readline';


export class Interaction {
    rl = readline.createInterface(process.stdin, process.stdout);

    prompt(s: string) {
        return new Promise(r => {
            this.rl.setPrompt(s);
            this.rl.prompt();
            this.rl.on('line', response => r(response));
        })
    }

    wait() {
        return new Promise(r => {
            this.rl.on('close', () => {
                r()
            })
        })
    }

    close() {
        this.rl.close();
    }
}