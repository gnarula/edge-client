import { Agent, InboundTransporter, OutboundTransporter, Connection } from 'aries-framework-javascript';
import { InitConfig, OutboundPackage, Message } from 'aries-framework-javascript/build/lib/types';
import fetch from 'node-fetch';
import { createOutboundMessage } from 'aries-framework-javascript/build/lib/protocols/helpers';
import { createTrustPingMessage } from 'aries-framework-javascript/build/lib/protocols/trustping/messages';
import { createCreateInboxMessage } from 'aries-framework-javascript/build/lib/protocols/routing/messages';
import { createBasicMessage } from 'aries-framework-javascript/build/lib/protocols/basicmessage/messages';
import { Interaction } from './interaction';
import { SignalRClient } from './signalrclient';

const config: InitConfig = {
  label: 'EdgeAgent',
  walletName: 'EdgeWallet',
  walletKey: '1234', // TODO: replace key
  agencyUrl: '', // TODO: Replace with Mediator URL
  url: '', // TODO: Replace with Mediator URL
  port: 80,
};

class WSInboundTransporter implements InboundTransporter {
  _signalRClient?: SignalRClient

  async start(agent: Agent) {
    // TODO: add check if connection is already established with agency
    // after we add support for persisting connections
    const agencyConnection = await this.establishConnectionWithAgency(agent);
    this._signalRClient = new SignalRClient(agent, agencyConnection);
    await this._signalRClient.init();
  }

  async establishConnectionWithAgency(agent: Agent) {
    const inviteUrl = `${agent.getAgencyUrl()}/.well-known/agent-configuration`;
    const invitationMessage = await (await fetch(inviteUrl)).json();
    const connectionRequest = await agent.connectionService.acceptInvitation(invitationMessage.Invitation);
    const { connection } = connectionRequest;

    const connectionResponsePacked = await agent.context.messageSender.sendMessageAndGetReply(connectionRequest);
    console.log('Received', connectionResponsePacked);
    const connectionResponse = await agent.context.wallet.unpack(connectionResponsePacked);
    console.log('Connection response', connectionResponse);
    await agent.connectionService.acceptResponse(connectionResponse);

    // Disable routing keys since messages will always be exchanged directly
    // We aren't using the trust ping message created above because it wraps the
    // message in a forward envelope.
    if (connection.theirDidDoc) {
      connection.theirDidDoc.service[0].routingKeys = [];
    }
    const trustPingMessage = createOutboundMessage(connection , createTrustPingMessage());
    await agent.context.messageSender.sendMessageAndGetReply(trustPingMessage);

    await connection.isConnected();

    const cInboxMessage = createOutboundMessage(connection, createCreateInboxMessage());
    await agent.context.messageSender.sendMessageAndGetReply(cInboxMessage);

    agent.establishInbound(invitationMessage.RoutingKey, connection);

    return connection;
  }

  close() {
    return this._signalRClient?.close();
  }
}

class HTTPOutboundTransporter implements OutboundTransporter {
  async sendMessage(outboundPackage: OutboundPackage, receive_reply: boolean): Promise<any> {
    const body = await fetch(outboundPackage.endpoint || '', {
      headers: [['Content-Type', 'application/ssi-agent-wire']],
      method: 'POST',
      body: JSON.stringify(outboundPackage.payload),
    });
    if (receive_reply) {
      return await body.json();
    }
    return null;
  }
}

const inboundTransporter = new WSInboundTransporter();
const outboundTransporter = new HTTPOutboundTransporter();

const agent = new Agent(config, inboundTransporter, outboundTransporter);

(async () => {
  console.log('Starting the agent...')
  await agent.init()

  const interaction = new Interaction();
  console.log('Agent initialized.')

  const invitationUrl = await interaction.prompt('Please enter the invitation url') as string;

  const theirKey = await agent.acceptInvitationUrl(invitationUrl);
  console.log('Connected');
  const connection = agent.findConnectionByMyKey(theirKey);

  if (!connection) {
    throw new Error('Unable to find connection of the other party');
  }

  connection?.on('basicMessageReceived', (message: Message) => {
    console.log(`${connection.theirDid} says ${message.content}`);
  });

  let flag = true
  while(flag) {
    const line = await interaction.prompt('[1] Send Message [X/x] Quit') as string;
    switch (line.trim()) {
      case '1':
        const content = await interaction.prompt("Message:") as string;
        await agent
          .context
          .messageSender
          .sendMessage(createOutboundMessage(connection, createBasicMessage(content)));
        break;
      case 'x':
      case 'X':
        flag = false;
        interaction.close();
        await (agent.inboundTransporter as WSInboundTransporter).close()
        break;
      default:
        break;
    }
  }
})();