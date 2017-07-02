import { Crazyflie } from '.';
import { BUFFER_TYPES, LOGGING_CHANNELS, LOGGING_COMMANDS, LOGGING_TYPES, PORTS, Type } from '../constants';
import { Ack, Packet } from '../packet';

/**
 * Telemetry for the Crazyflie
 * (https://wiki.bitcraze.io/doc:crazyflie:crtp:log)
 */

export class Logging {

	// Table of contents

	// How many items in the table of contents
	tocLength: number;
	// Cyclic redundancy check - checksum for possible TOC caching
	tocCrc: number;
	// Max amount of packets that can be programmed into the copter
	tocMaxPackets: number;
	// Max amount of operations that can be programmed into the copter
	// (1 operation = 1 log variable retrieval programming)
	tocMaxOperations: number;

	toc: TOCItem[] = [];

	constructor(private crazyflie: Crazyflie) {
		this.crazyflie.radio.on('logging', (ackPack: Ack) => {
			// Route the packet to the correct handler function
			switch (ackPack.channel) {
				case LOGGING_CHANNELS.TOC:
					// Find out which command
					switch (ackPack.data[0]) {
						case LOGGING_COMMANDS.TOC.GET_ITEM:
							this.handleTOCItem(ackPack.data.slice(1));
							break;
						case LOGGING_COMMANDS.TOC.GET_INFO:
							this.handleTOC(ackPack.data.slice(1));
							break;
					}
					break;
				case LOGGING_CHANNELS.LOG_CTRL:
					break;
				case LOGGING_CHANNELS.LOG_DATA:
					break;
				default:
					this.crazyflie.emit('error', `Unrecognized logging channel "${ackPack.data[0]}"!`);
					break;
			}
		});
	}

	/**
	 * Gets the table of contents from the Crazyflie
	 * Required first in order to retrieve values
	 * (https://wiki.bitcraze.io/doc:crazyflie:crtp:log#table_of_content_access)
	 */

	getTOC() {
		const packet = new Packet();
		packet.port = PORTS.LOGGING;
		packet.channel = LOGGING_CHANNELS.TOC;

		packet.write('int8', LOGGING_COMMANDS.TOC.GET_INFO);

		return this.crazyflie.radio.sendPacket(packet);
	}

	/**
	 * Handle TOC response
	 * (https://wiki.bitcraze.io/doc:crazyflie:crtp:log#get_info)
	 */

	private async handleTOC(data: Buffer) {
		const types = BUFFER_TYPES(data);
		this.tocLength = types.int8.read(0);
		this.tocCrc = types.int32.read(1);
		this.tocMaxPackets = types.int8.read(5);
		this.tocMaxOperations = types.int8.read(6);

		console.log('Get TOC length', this.tocLength);

		try {
			await this.fetchTOCItem(0);
		} catch (err) {
			this.crazyflie.emit('error', err);
		}
	}

	/**
	 * Fetch TOC item from the Crazyflie
	 * (https://wiki.bitcraze.io/doc:crazyflie:crtp:log#get_toc_item)
	 */

	fetchTOCItem(id: number) {
		if (0 > id || id >= this.tocLength) {
			return Promise.reject(`Id "${id}" is out of range! (0-${this.tocLength - 1} inclusive)`);
		}

		console.log('Get TOC item invoked', id);

		const packet = new Packet();
		packet.port = PORTS.LOGGING;
		packet.channel = LOGGING_CHANNELS.TOC;

		packet
			.write('int8', LOGGING_COMMANDS.TOC.GET_ITEM)
			.write('int8', id);

		return this.crazyflie.radio.sendPacket(packet);
	}

	/**
	 * Handle TOC item response
	 * (https://wiki.bitcraze.io/doc:crazyflie:crtp:log#get_toc_item)
	 */

	private async handleTOCItem(data: Buffer) {
		const types = BUFFER_TYPES(data);

		const id = types.int8.read(0);
		const type = LOGGING_TYPES[types.int8.read(1)];
		const [ group, name ] = data.slice(2).toString().split('\u0000');
		console.log('TOC Item', id, 'type', type, 'group', group, 'name', name);

		this.toc.push({
			id,
			type,
			group,
			name
		});

		console.log(`(${this.toc.length} / ${this.tocLength}) We are ${this.tocLength - this.toc.length} items left!`);

		// If that was final block, telemetry is ready
		if (this.tocLength >= this.toc.length) {
			this.crazyflie.emit('telemetry ready');
		} else {
			try {
				await this.fetchTOCItem(id + 1);
			} catch (err) {
				this.crazyflie.emit('error', err);
			}
		}
	}

}

export interface TOCItem {
	id: number;
	type: Type;
	group: string;
	name: string;
}
