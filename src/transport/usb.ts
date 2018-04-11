/*
* DAPjs
* Copyright Arm Limited 2018
*
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in all
* copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
* SOFTWARE.
*/

import {
    LIBUSB_REQUEST_TYPE_CLASS,
    LIBUSB_RECIPIENT_INTERFACE,
    LIBUSB_ENDPOINT_IN,
    LIBUSB_ENDPOINT_OUT,
    Device,
    Interface,
    OutEndpoint,
    InEndpoint
} from "usb";
import { Transport } from "./index";

const DEFAULT_CLASS = 0xFF;
const PACKET_SIZE = 64;

const GET_REPORT = 0x01;
const SET_REPORT = 0x09;
const OUT_REPORT = 0x200;
const IN_REPORT = 0x100;

/**
 * USB Transport class
 */
export class USB implements Transport {

    private interface: Interface;
    private endpointIn: InEndpoint;
    private endpointOut: OutEndpoint;

    /**
     * USB constructor
     * @param device USB device to use
     * @param interfaceClass Optional interface class to use
     */
    constructor(private device: Device, private interfaceClass = DEFAULT_CLASS) {
    }

    private bufferToDataView(buffer: Buffer): DataView {
        const arrayBuffer = new Uint8Array(buffer).buffer;
        return new DataView(arrayBuffer);
    }

    private bufferSourceToBuffer(bufferSource: ArrayBuffer | ArrayBufferView): Buffer {
        function isView(source: ArrayBuffer | ArrayBufferView): source is ArrayBufferView {
            return (source as ArrayBufferView).buffer !== undefined;
        }

        const arrayBuffer = isView(bufferSource) ? bufferSource.buffer : bufferSource;
        return new Buffer(arrayBuffer);
    }

    private sliceBuffer(data: BufferSource, packetSize: number): BufferSource {
        function isView(source: ArrayBuffer | ArrayBufferView): source is ArrayBufferView {
            return (source as ArrayBufferView).buffer !== undefined;
        }

        const arrayBuffer = isView(data) ? data.buffer : data;
        const length = Math.min(arrayBuffer.byteLength, packetSize);

        return arrayBuffer.slice(length);
    }

    /**
     * Open device
     * @returns Promise
     */
    public open(): Promise<void> {
        this.endpointIn = null;
        this.endpointOut = null;

        return new Promise((resolve, reject) => {
            this.device.open();
            this.device.setConfiguration(1, error => {
                if (error) return reject(error);
                const interfaces = this.device.interfaces.filter(iface => {
                    return iface.descriptor.bInterfaceClass === this.interfaceClass;
                });

                if (!interfaces.length) {
                    throw new Error("No HID interfaces found.");
                }

                this.interface = interfaces[0];
                this.interface.endpoints.forEach(endpoint => {
                    if (endpoint.direction === "in") this.endpointIn = endpoint as InEndpoint;
                    else this.endpointOut = endpoint as OutEndpoint;
                });

                resolve();
            });
        });
    }

    /**
     * Close device
     * @returns Promise
     */
    public close(): Promise<void> {
        return new Promise((resolve, _reject) => {
            this.device.close();
            resolve();
        });
    }

    /**
     * Read from device
     * @returns Promise of DataView
     */
    public read(): Promise<DataView> {
        // Use the endpoint if it exists
        if (this.endpointIn) {
            return new Promise((resolve, reject) => {
                const packetSize = this.endpointIn.descriptor.wMaxPacketSize;
                this.endpointIn.transfer(packetSize, (error, data) => {
                    if (error) return reject(error);

                    resolve(this.bufferToDataView(data));
                });
            });
        }

        // Device does not have endpoint, use control transfer
        return new Promise((resolve, reject) => {
            this.device.controlTransfer(
                LIBUSB_ENDPOINT_IN | LIBUSB_REQUEST_TYPE_CLASS | LIBUSB_RECIPIENT_INTERFACE,
                GET_REPORT,
                IN_REPORT,
                this.interface.interface,
                PACKET_SIZE,
                (error, buffer) => {
                    if (error) return reject(error);
                    resolve(this.bufferToDataView(buffer));
                }
            );
        });
    }

    /**
     * Write to device
     * @param data Data to write
     * @returns Promise
     */
    public write(data: BufferSource): Promise<any> {
        let buffer: BufferSource;

        // Use the endpoint if it exists
        if (this.endpointOut) {
            return new Promise((resolve, reject) => {
                const packetSize = this.endpointOut.descriptor.wMaxPacketSize;
                buffer = this.sliceBuffer(data, packetSize);

                this.endpointOut.transfer(this.bufferSourceToBuffer(buffer), (error: string) => {
                    if (error) return reject(error);
                    resolve();
                });
            });
        }

        // Device does not have endpoint, use control transfer
        buffer = this.sliceBuffer(data, PACKET_SIZE);

        return new Promise((resolve, reject) => {
            this.device.controlTransfer(
                LIBUSB_ENDPOINT_OUT | LIBUSB_REQUEST_TYPE_CLASS | LIBUSB_RECIPIENT_INTERFACE,
                SET_REPORT,
                OUT_REPORT,
                this.interface.interface,
                this.bufferSourceToBuffer(buffer),
                (error: string) => {
                    if (error) return reject(error);
                    resolve();
                }
            );
        });
    }
}
