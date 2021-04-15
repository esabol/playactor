import open from "open";

import { IInputOutput } from "../../cli/io";
import { OauthStrategy } from "./model";

export class CliOauthStrategy implements OauthStrategy {
    constructor(
        private io: IInputOutput,
        private autoOpenUrls: boolean = true,
    ) {}

    public async performLogin(url: string): Promise<string> {
        if (this.autoOpenUrls) {
            this.io.logInfo("In a moment, we will attempt to open a browser window for you to login to your PSN account.");
            this.printLoginInstructions();

            await this.io.prompt("Hit ENTER to continue");

            try {
                await open(url, { wait: true });
            } catch (e) {
                this.io.logInfo("Unable to open the browser for you. This is fine; please manually open the following URL:");
                this.io.logInfo(`  ${url}`);
            }
        } else {
            this.io.logInfo("Open the following URL in a web browser to login to your PSN account.");
            this.printLoginInstructions();
            this.io.logInfo(`  ${url}`);
        }

        return this.io.prompt("URL> ");
    }

    private printLoginInstructions() {
        this.io.logInfo("When the page shows \"redirect\", copy the URL from your browser's address bar and paste it here.");
    }
}
