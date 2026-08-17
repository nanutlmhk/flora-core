using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Ports;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Security.Authentication;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MQTTnet;
using MQTTnet.Client;
using MQTTnet.Diagnostics;
using MQTTnet.Extensions.ManagedClient;
using MQTTnet.Protocol;

namespace VSCaptureDrgInf
{
	// Token: 0x02000003 RID: 3
	public sealed class DSerialPort : SerialPort
	{
		// Token: 0x14000001 RID: 1
		// (add) Token: 0x06000003 RID: 3 RVA: 0x00002084 File Offset: 0x00000284
		// (remove) Token: 0x06000004 RID: 4 RVA: 0x000020B8 File Offset: 0x000002B8
		public static event DSerialPort.DataReceivedEventHandler DataReceivedEvent;

		// Token: 0x17000001 RID: 1
		// (get) Token: 0x06000005 RID: 5 RVA: 0x000020EC File Offset: 0x000002EC
		public static DSerialPort getInstance
		{
			get
			{
				if (DSerialPort.DPort == null)
				{
					Type typeFromHandle = typeof(DSerialPort);
					lock (typeFromHandle)
					{
						if (DSerialPort.DPort == null)
						{
							DSerialPort.DPort = new DSerialPort();
						}
					}
				}
				return DSerialPort.DPort;
			}
		}

		// Token: 0x06000006 RID: 6 RVA: 0x00002150 File Offset: 0x00000350
		public DSerialPort()
		{
			DSerialPort.DPort = this;
			this.DPortBufSize = 4096;
			this.DPort_rxbuf = new byte[this.DPortBufSize];
			if (this.OSIsUnix())
			{
				DSerialPort.DPort.PortName = "/dev/ttyUSB0";
			}
			else
			{
				DSerialPort.DPort.PortName = "COM1";
			}
			DSerialPort.DPort.BaudRate = 19200;
			DSerialPort.DPort.Parity = Parity.None;
			DSerialPort.DPort.DataBits = 8;
			DSerialPort.DPort.StopBits = StopBits.One;
			DSerialPort.DPort.Handshake = Handshake.None;
			DSerialPort.DPort.ReadTimeout = 600000;
			DSerialPort.DPort.WriteTimeout = 600000;
			if (!this.OSIsUnix())
			{
				DSerialPort.DPort.DataReceived += delegate(object sender, SerialDataReceivedEventArgs e)
				{
					this.ReadBuffer();
				};
			}
			if (this.OSIsUnix())
			{
				DSerialPort.DataReceivedEvent += delegate(object sender, EventArgs e)
				{
					this.ReadBuffer();
				};
			}
			DSerialPort.DPort.Encoding = Encoding.GetEncoding("ISO-8859-1");
		}

		// Token: 0x06000007 RID: 7 RVA: 0x000022EB File Offset: 0x000004EB
		public void OnSerialDataReceived()
		{
			if (this.OSIsUnix())
			{
				Task.Run(delegate
				{
					do
					{
						if (DSerialPort.DPort.BytesToRead != 0)
						{
							DSerialPort.DataReceivedEventHandler dataReceivedEvent = DSerialPort.DataReceivedEvent;
							if (dataReceivedEvent != null)
							{
								dataReceivedEvent(DSerialPort.DPort, new EventArgs());
							}
						}
					}
					while (!this.m_cancellationTokenSource.IsCancellationRequested);
				});
			}
		}

		// Token: 0x06000008 RID: 8 RVA: 0x00002307 File Offset: 0x00000507
		public void StartProcessing()
		{
			DSerialPort.DPort.Open();
			DSerialPort.DPort.OnSerialDataReceived();
		}

		// Token: 0x06000009 RID: 9 RVA: 0x00002321 File Offset: 0x00000521
		public void DebugLine(string msg)
		{
		}

		// Token: 0x0600000A RID: 10 RVA: 0x00002323 File Offset: 0x00000523
		public void RequestStatus()
		{
			DSerialPort.DPort.WriteBuffer(DataConstants.poll_request_software_id_status_request);
			this.DebugLine("Send: Request Status");
		}

		// Token: 0x0600000B RID: 11 RVA: 0x00002341 File Offset: 0x00000541
		public void RequestParameterData1()
		{
			DSerialPort.DPort.WriteBuffer(DataConstants.poll_request_parameter_data);
			this.DebugLine("Send: Request Data 1");
		}

		// Token: 0x0600000C RID: 12 RVA: 0x0000235F File Offset: 0x0000055F
		public void RequestParameterData2()
		{
			DSerialPort.DPort.WriteBuffer(DataConstants.poll_request_parameter_data_format);
			this.DebugLine("Send: Request Data 2");
		}

		// Token: 0x0600000D RID: 13 RVA: 0x00002380 File Offset: 0x00000580
		public void WriteBuffer(byte[] txbuf)
		{
			List<byte> temptxbufflist = new List<byte>();
			if (txbuf.Length != 0)
			{
				temptxbufflist.AddRange(txbuf);
				byte[] inputbuffer = temptxbufflist.ToArray();
				byte checksumcomputed = new Crc().ComputeChecksum(inputbuffer);
				byte[] checksumarray = new byte[] { checksumcomputed };
				temptxbufflist.AddRange(checksumarray);
				byte[] finaltxbuff = temptxbufflist.ToArray();
				try
				{
					DSerialPort.DPort.Write(finaltxbuff, 0, finaltxbuff.Length);
				}
				catch (Exception ex)
				{
					Console.WriteLine("Error opening/writing to serial port :: " + ex.Message, "Error!");
				}
			}
		}

		// Token: 0x0600000E RID: 14 RVA: 0x00002410 File Offset: 0x00000610
		public async Task SendCycledRequests(int nInterval)
		{
			int nmillisecond = nInterval * 1000;
			if (nmillisecond == 0)
			{
				this.RequestParameterData1();
				this.RequestParameterData2();
				return;
			}
			for (;;)
			{
				this.RequestParameterData1();
				this.RequestParameterData2();
				await Task.Delay(nmillisecond);
			}
		}

		// Token: 0x0600000F RID: 15 RVA: 0x0000245C File Offset: 0x0000065C
		public void ClearReadBuffer()
		{
			for (int i = 0; i < this.DPortBufSize; i++)
			{
				this.DPort_rxbuf[i] = 0;
			}
		}

		// Token: 0x06000010 RID: 16 RVA: 0x00002484 File Offset: 0x00000684
		public int ReadBuffer()
		{
			int bytesreadtotal = 0;
			if (!this.m_cancellationTokenSource.IsCancellationRequested)
			{
				try
				{
					string path = Path.Combine(Directory.GetCurrentDirectory(), "DrgInfRawoutput.raw");
					do
					{
						this.ClearReadBuffer();
						int lenread = DSerialPort.DPort.Read(this.DPort_rxbuf, 0, this.DPortBufSize);
						byte[] copyarray = new byte[lenread];
						for (int i = 0; i < lenread; i++)
						{
							copyarray[i] = this.DPort_rxbuf[i];
							this.CreateFrameListFromByteSync(copyarray[i]);
						}
						this.ByteArrayToFile(path, copyarray, copyarray.GetLength(0));
						bytesreadtotal += lenread;
					}
					while (DSerialPort.DPort.BytesToRead != 0);
					if (DSerialPort.DPort.BytesToRead == 0 && this.FrameList.Count > 0)
					{
						this.ReadFrameData();
						this.FrameList.RemoveRange(0, this.FrameList.Count);
					}
				}
				catch (Exception ex)
				{
					Console.WriteLine("Error opening/writing to serial port :: " + ex.Message, "Error!");
				}
			}
			return bytesreadtotal;
		}

		// Token: 0x06000011 RID: 17 RVA: 0x00002590 File Offset: 0x00000790
		public void CreateFrameListFromByteSync(byte bvalue)
		{
			if (bvalue == 165)
			{
				if (this.m_fstart)
				{
					this.m_fstart = false;
					this.m_storestart = true;
					this.m_ResponseByteList.Add(bvalue);
				}
				else
				{
					this.m_storeend = true;
					this.m_ResponseByteList.Add(bvalue);
				}
			}
			else if (this.m_storestart && !this.m_storeend)
			{
				this.m_ResponseByteList.Add(bvalue);
			}
			if (this.m_storeend)
			{
				int framelen = this.m_ResponseByteList.Count<byte>();
				if (framelen != 0)
				{
					byte[] bArray = this.m_ResponseByteList.ToArray();
					int userdataframelen = framelen - 2;
					byte[] userdataArray = new byte[userdataframelen];
					Array.Copy(bArray, 0, userdataArray, 0, userdataframelen);
					byte b = new Crc().ComputeChecksum(userdataArray);
					byte checksum = bArray[framelen - 2];
					if (b == checksum)
					{
						this.FrameList.Add(userdataArray);
					}
					else
					{
						Console.WriteLine("Checksum Error");
					}
					this.m_ResponseByteList.RemoveRange(1, framelen - 1);
					this.m_storestart = true;
					this.m_storeend = false;
					this.m_fstart = false;
					return;
				}
				this.m_storestart = true;
				this.m_storeend = false;
				this.m_fstart = false;
			}
		}

		// Token: 0x06000012 RID: 18 RVA: 0x000026A0 File Offset: 0x000008A0
		public void ReadFrameData()
		{
			if (this.FrameList.Count > 0)
			{
				foreach (byte[] fArray in this.FrameList)
				{
					this.ProcessPacket(fArray);
				}
			}
		}

		// Token: 0x06000013 RID: 19 RVA: 0x00002704 File Offset: 0x00000904
		public void ProcessPacket(byte[] packetbuffer)
		{
			string responsetype = Encoding.GetEncoding("ISO-8859-1").GetString(packetbuffer).Substring(3, 1);
			this.m_strTimestamp = DateTime.Now.ToString("dd-MM-yyyy HH:mm:ss.fff", CultureInfo.InvariantCulture);
			Console.WriteLine("Timestamp:{0}", this.m_strTimestamp);
			if (!(responsetype == "P") && !(responsetype == "V"))
			{
				if (responsetype == "W")
				{
					this.m_parametertype = 87;
					this.ParseDataResponse(packetbuffer);
					this.SaveNumericValueListRows("Numerics1");
					return;
				}
				if (!(responsetype == "w"))
				{
					return;
				}
				this.m_parametertype = 119;
				this.ParseDataResponse(packetbuffer);
				this.SaveNumericValueListRows("Numerics2");
			}
		}

		// Token: 0x06000014 RID: 20 RVA: 0x000027C0 File Offset: 0x000009C0
		public void ParseDataResponse(byte[] packetbuffer)
		{
			if (packetbuffer.Length != 0)
			{
				BinaryReader binaryReader = new BinaryReader(new MemoryStream(packetbuffer));
				binaryReader.ReadByte();
				binaryReader.ReadBytes(2);
				int packetbufferlen = packetbuffer.Length;
				binaryReader.ReadBytes(20);
				binaryReader.ReadByte();
				BinaryReader binreader2 = new BinaryReader(new MemoryStream(binaryReader.ReadBytes(packetbufferlen - 24)));
				while (binreader2.BaseStream.Position < binreader2.BaseStream.Length)
				{
					this.ReadSubpacketData(ref binreader2);
				}
			}
		}

		// Token: 0x06000015 RID: 21 RVA: 0x00002838 File Offset: 0x00000A38
		public void ReadSubpacketData(ref BinaryReader binreader)
		{
			int subpacketlen = (int)binreader.ReadByte();
			binreader.ReadByte();
			binreader.ReadBytes(6);
			BinaryReader binreader2 = new BinaryReader(new MemoryStream(binreader.ReadBytes(subpacketlen - 8)));
			while (binreader2.BaseStream.Position < binreader2.BaseStream.Length)
			{
				byte parametertype = this.m_parametertype;
				if (parametertype != 87)
				{
					if (parametertype == 119)
					{
						this.ReadParameterData(ref binreader2);
					}
				}
				else
				{
					this.ReadParameterData(ref binreader2);
				}
			}
		}

		// Token: 0x06000016 RID: 22 RVA: 0x000028B4 File Offset: 0x00000AB4
		public void ReadParameterData(ref BinaryReader binreader)
		{
			ushort paramcode = 0;
			if (this.m_parametertype == 87)
			{
				paramcode = (ushort)binreader.ReadByte();
			}
			else if (this.m_parametertype == 119)
			{
				byte[] paramcodebytes = binreader.ReadBytes(2);
				if (paramcodebytes.Length != 0)
				{
					paramcode = BitConverter.ToUInt16(paramcodebytes, 0);
				}
			}
			if (paramcode != 242)
			{
				binreader.ReadByte();
			}
			string physio_id = Enum.GetName(typeof(DataConstants.ParameterCode), paramcode);
			try
			{
				byte[] paramdatavalue = this.ReadNullTerminatedParameter(ref binreader);
				if (paramcode != 0 && physio_id != null)
				{
					string strParamValue = this.CheckParamValueforID(paramdatavalue, paramcode);
					Console.WriteLine("{0}: {1}", physio_id, strParamValue);
					Console.WriteLine();
					DSerialPort.NumericValResult NumVal = new DSerialPort.NumericValResult();
					NumVal.Timestamp = this.m_strTimestamp;
					NumVal.PhysioID = physio_id;
					NumVal.Value = DSerialPort.CheckValue(strParamValue);
					this.m_NumericValList.Add(NumVal);
					this.m_NumValHeaders.Add(NumVal.PhysioID);
				}
			}
			catch (Exception ex)
			{
				Console.WriteLine("Error opening/writing to serial port :: " + ex.Message, "Error!");
			}
		}

		// Token: 0x06000017 RID: 23 RVA: 0x000029C0 File Offset: 0x00000BC0
		public byte[] ReadNullTerminatedParameter(ref BinaryReader binreader)
		{
			List<byte> output = new List<byte>();
			int count = 0;
			while (binreader.BaseStream.Position < binreader.BaseStream.Length)
			{
				byte b = binreader.ReadByte();
				output.Add(b);
				if (b == 0)
				{
					break;
				}
				count++;
			}
			return output.ToArray();
		}

		// Token: 0x06000018 RID: 24 RVA: 0x00002A0D File Offset: 0x00000C0D
		public static string CheckValue(string strValue)
		{
			if (strValue == "" || strValue == null)
			{
				strValue = "-";
			}
			return strValue;
		}

		// Token: 0x06000019 RID: 25 RVA: 0x00002A28 File Offset: 0x00000C28
		public string CheckParamValueforID(byte[] paramdatavalue, ushort paramcode)
		{
			string strValue = Encoding.ASCII.GetString(paramdatavalue);
			if (strValue != null && strValue != "")
			{
				if (strValue.Contains("***") || strValue.Contains("+++") || strValue.Contains("---") || strValue.Contains('?'))
				{
					strValue = "-";
				}
			}
			else
			{
				strValue = "-";
			}
			if (paramcode == 2 || paramcode == 3)
			{
				ushort arrcode = DSerialPort.correctendianshortus(BitConverter.ToUInt16(paramdatavalue, 1));
				strValue = Enum.GetName(typeof(DataConstants.ParameterCode), arrcode);
			}
			if (paramcode == 24)
			{
				ushort agentcode = DSerialPort.correctendianshortus(BitConverter.ToUInt16(paramdatavalue, 1));
				strValue = Enum.GetName(typeof(DataConstants.AgentStatus), agentcode);
			}
			if (paramcode == 224 || paramcode == 225 || paramcode == 226 || paramcode == 225)
			{
				ushort eegcode = DSerialPort.correctendianshortus(BitConverter.ToUInt16(paramdatavalue, 1));
				strValue = Enum.GetName(typeof(DataConstants.EEGLeadLabels), eegcode);
			}
			if (paramcode == 219)
			{
				ushort gascode = DSerialPort.correctendianshortus(BitConverter.ToUInt16(paramdatavalue, 1));
				strValue = Enum.GetName(typeof(DataConstants.GasCombination), gascode);
			}
			if (paramcode == 222)
			{
				ushort breathcode = DSerialPort.correctendianshortus(BitConverter.ToUInt16(paramdatavalue, 1));
				strValue = Enum.GetName(typeof(DataConstants.BreathingCircuit), breathcode);
			}
			if (paramcode == 223)
			{
				ushort ventcode = DSerialPort.correctendianshortus(BitConverter.ToUInt16(paramdatavalue, 1));
				strValue = Enum.GetName(typeof(DataConstants.VentilationMode), ventcode);
			}
			if (paramcode == 242)
			{
				try
				{
					int day = (int)paramdatavalue[0];
					int hour = (int)paramdatavalue[1];
					int min = (int)paramdatavalue[2];
					int sec = (int)paramdatavalue[3];
					DateTime dt = DateTime.Now;
					DateTime dateTime = new DateTime(dt.Year, dt.Month, day, hour, min, sec);
					strValue = dateTime.ToString();
				}
				catch
				{
					strValue = "-";
				}
			}
			if (strValue != null && strValue != "" && strValue != "-")
			{
				if (Encoding.ASCII.GetString(paramdatavalue).Contains("^^"))
				{
					ushort ConditionIDcode = DSerialPort.correctendianshortus(BitConverter.ToUInt16(paramdatavalue, 2));
					strValue = Enum.GetName(typeof(DataConstants.ParameterID), ConditionIDcode);
				}
			}
			else
			{
				strValue = "-";
			}
			return strValue;
		}

		// Token: 0x0600001A RID: 26 RVA: 0x00002C74 File Offset: 0x00000E74
		public static ushort correctendianshortus(ushort sValue)
		{
			byte[] bArray = BitConverter.GetBytes(sValue);
			if (BitConverter.IsLittleEndian)
			{
				Array.Reverse<byte>(bArray);
			}
			return BitConverter.ToUInt16(bArray, 0);
		}

		// Token: 0x0600001B RID: 27 RVA: 0x00002C9C File Offset: 0x00000E9C
		public void StopTransfer()
		{
			this.m_cancellationTokenSource.Cancel();
			base.Dispose();
		}

		// Token: 0x0600001C RID: 28 RVA: 0x00002CB0 File Offset: 0x00000EB0
		private bool WriteHeadersForDatatype(string datatype)
		{
			bool writeheader = true;
			if (!(datatype == "Numerics1"))
			{
				if (datatype == "Numerics2")
				{
					if (this.m_transmissionstart2)
					{
						this.m_transmissionstart2 = false;
					}
					else
					{
						writeheader = false;
					}
				}
			}
			else if (this.m_transmissionstart)
			{
				this.m_transmissionstart = false;
			}
			else
			{
				writeheader = false;
			}
			return writeheader;
		}

		// Token: 0x0600001D RID: 29 RVA: 0x00002D04 File Offset: 0x00000F04
		public void WriteNumericHeadersList(string datatype)
		{
			if (this.m_NumericValList.Count != 0 && this.WriteHeadersForDatatype(datatype))
			{
				string filename = string.Format("DrgInf{0}DataExport.csv", datatype);
				string pathcsv = Path.Combine(Directory.GetCurrentDirectory(), filename);
				this.m_strbuildheaders.Append("Time");
				this.m_strbuildheaders.Append(',');
				foreach (DSerialPort.NumericValResult NumValResult in this.m_NumericValList)
				{
					this.m_strbuildheaders.Append(NumValResult.PhysioID);
					this.m_strbuildheaders.Append(',');
				}
				this.m_strbuildheaders.Remove(this.m_strbuildheaders.Length - 1, 1);
				this.m_strbuildheaders.Replace(",,", ",");
				this.m_strbuildheaders.AppendLine();
				this.ExportNumValListToCSVFile(pathcsv, this.m_strbuildheaders);
				this.m_strbuildheaders.Clear();
				this.m_NumValHeaders.RemoveRange(0, this.m_NumValHeaders.Count);
			}
		}

		// Token: 0x0600001E RID: 30 RVA: 0x00002E30 File Offset: 0x00001030
		public void SaveNumericValueListRows(string datatype)
		{
			if (this.m_dataexportset == 2)
			{
				this.ExportNumValListToJSON(datatype);
			}
			if (this.m_dataexportset == 3)
			{
				this.ExportNumValListToMQTT(datatype);
			}
			if (this.m_dataexportset == 4)
			{
				this.ExportNumValListToJSONFile(datatype);
			}
			if (this.m_dataexportset != 3 && this.m_dataexportset != 4 && this.m_NumericValList.Count != 0)
			{
				this.WriteNumericHeadersList(datatype);
				string filename = string.Format("DrgInf{0}DataExport.csv", datatype);
				string pathcsv = Path.Combine(Directory.GetCurrentDirectory(), filename);
				this.m_strbuildvalues.Append(this.m_NumericValList.ElementAt(0).Timestamp);
				this.m_strbuildvalues.Append(',');
				foreach (DSerialPort.NumericValResult NumValResult in this.m_NumericValList)
				{
					this.m_strbuildvalues.Append(NumValResult.Value);
					this.m_strbuildvalues.Append(',');
				}
				this.m_strbuildvalues.Remove(this.m_strbuildvalues.Length - 1, 1);
				this.m_strbuildvalues.Replace(",,", ",");
				this.m_strbuildvalues.AppendLine();
				this.ExportNumValListToCSVFile(pathcsv, this.m_strbuildvalues);
				this.m_strbuildvalues.Clear();
				this.m_NumericValList.RemoveRange(0, this.m_NumericValList.Count);
			}
		}

		// Token: 0x0600001F RID: 31 RVA: 0x00002FAC File Offset: 0x000011AC
		public void ExportNumValListToCSVFile(string _FileName, StringBuilder strbuildNumVal)
		{
			try
			{
				using (StreamWriter wrStream = new StreamWriter(_FileName, true, Encoding.UTF8))
				{
					wrStream.Write(strbuildNumVal);
					strbuildNumVal.Clear();
					wrStream.Close();
				}
			}
			catch (Exception _Exception)
			{
				Console.WriteLine("Exception caught in process: {0}", _Exception.ToString());
			}
		}

		// Token: 0x06000020 RID: 32 RVA: 0x00003018 File Offset: 0x00001218
		public bool ByteArrayToFile(string _FileName, byte[] _ByteArray, int nWriteLength)
		{
			try
			{
				using (FileStream _FileStream = new FileStream(_FileName, FileMode.Append, FileAccess.Write))
				{
					_FileStream.Write(_ByteArray, 0, nWriteLength);
					_FileStream.Close();
				}
				return true;
			}
			catch (Exception _Exception)
			{
				Console.WriteLine("Exception caught in process: {0}", _Exception.ToString());
			}
			return false;
		}

		// Token: 0x06000021 RID: 33 RVA: 0x00003080 File Offset: 0x00001280
		public void ExportNumValListToJSON(string datatype)
		{
			if (this.m_NumericValList.Count != 0)
			{
				string serializedJSON = JsonSerializer.Serialize<List<DSerialPort.NumericValResult>>(this.m_NumericValList, new JsonSerializerOptions
				{
					IncludeFields = true
				});
				try
				{
					Task.Run(() => this.PostJSONDataToServer(serializedJSON));
				}
				catch (Exception _Exception)
				{
					Console.WriteLine("Exception caught in process: {0}", _Exception.ToString());
				}
			}
		}

		// Token: 0x06000022 RID: 34 RVA: 0x000030FC File Offset: 0x000012FC
		public void ExportNumValListToJSONFile(string datatype)
		{
			if (this.m_NumericValList.Count != 0)
			{
				string serializedJSON = JsonSerializer.Serialize<List<DSerialPort.NumericValResult>>(this.m_NumericValList, new JsonSerializerOptions
				{
					IncludeFields = true
				});
				serializedJSON = serializedJSON.Replace("[]", "");
				this.m_NumericValList.RemoveRange(0, this.m_NumericValList.Count);
				string filename = string.Format("DataExportVSC.json", Array.Empty<object>());
				string pathjson = Path.Combine(Directory.GetCurrentDirectory(), filename);
				try
				{
					using (StreamWriter wrStream = new StreamWriter(pathjson, true, Encoding.UTF8))
					{
						wrStream.WriteLine(serializedJSON);
						wrStream.Close();
					}
				}
				catch (Exception _Exception)
				{
					Console.WriteLine("Exception caught in process: {0}", _Exception.ToString());
				}
			}
		}

		// Token: 0x06000023 RID: 35 RVA: 0x000031D0 File Offset: 0x000013D0
		public async Task PostJSONDataToServer(string postData)
		{
			using (HttpClient client = new HttpClient())
			{
				ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls | SecurityProtocolType.Tls11 | SecurityProtocolType.Tls12;
				StringContent data = new StringContent(postData, Encoding.UTF8, "application/json");
				HttpResponseMessage httpResponseMessage = await client.PostAsync(this.m_jsonposturl, data);
				httpResponseMessage.EnsureSuccessStatusCode();
				Console.WriteLine(await httpResponseMessage.Content.ReadAsStringAsync());
			}
			HttpClient client = null;
		}

		// Token: 0x06000024 RID: 36 RVA: 0x0000321C File Offset: 0x0000141C
		public void ExportNumValListToMQTT(string datatype)
		{
			DSerialPort.<>c__DisplayClass62_0 CS$<>8__locals1 = new DSerialPort.<>c__DisplayClass62_0();
			CS$<>8__locals1.<>4__this = this;
			if (this.m_NumericValList.Count != 0)
			{
				CS$<>8__locals1.serializedJSON = JsonSerializer.Serialize<List<DSerialPort.NumericValResult>>(this.m_NumericValList, new JsonSerializerOptions
				{
					IncludeFields = true
				});
				this.m_NumericValList.RemoveRange(0, this.m_NumericValList.Count);
				CancellationTokenSource source = new CancellationTokenSource();
				CS$<>8__locals1.token = source.Token;
				IMqttClient mqttClient = new MqttFactory().CreateMqttClient();
				IMqttNetLogger logger = new MqttFactory().DefaultLogger;
				CS$<>8__locals1.managedClient = new ManagedMqttClient(mqttClient, logger);
				CS$<>8__locals1.topic = this.m_MQTTtopic + string.Format("/{0}", datatype);
				try
				{
					Task.Run(delegate
					{
						DSerialPort.<>c__DisplayClass62_0.<<ExportNumValListToMQTT>b__0>d <<ExportNumValListToMQTT>b__0>d;
						<<ExportNumValListToMQTT>b__0>d.<>t__builder = AsyncTaskMethodBuilder.Create();
						<<ExportNumValListToMQTT>b__0>d.<>4__this = CS$<>8__locals1;
						<<ExportNumValListToMQTT>b__0>d.<>1__state = -1;
						<<ExportNumValListToMQTT>b__0>d.<>t__builder.Start<DSerialPort.<>c__DisplayClass62_0.<<ExportNumValListToMQTT>b__0>d>(ref <<ExportNumValListToMQTT>b__0>d);
						return <<ExportNumValListToMQTT>b__0>d.<>t__builder.Task;
					}).ContinueWith(delegate(Task antecedent)
					{
						if (antecedent.Status == TaskStatus.RanToCompletion)
						{
							Func<Task> func;
							if ((func = CS$<>8__locals1.<>9__2) == null)
							{
								func = (CS$<>8__locals1.<>9__2 = delegate
								{
									DSerialPort.<>c__DisplayClass62_0.<<ExportNumValListToMQTT>b__2>d <<ExportNumValListToMQTT>b__2>d;
									<<ExportNumValListToMQTT>b__2>d.<>t__builder = AsyncTaskMethodBuilder.Create();
									<<ExportNumValListToMQTT>b__2>d.<>4__this = CS$<>8__locals1;
									<<ExportNumValListToMQTT>b__2>d.<>1__state = -1;
									<<ExportNumValListToMQTT>b__2>d.<>t__builder.Start<DSerialPort.<>c__DisplayClass62_0.<<ExportNumValListToMQTT>b__2>d>(ref <<ExportNumValListToMQTT>b__2>d);
									return <<ExportNumValListToMQTT>b__2>d.<>t__builder.Task;
								});
							}
							Task.Run(func);
						}
					});
				}
				catch (Exception _Exception)
				{
					Console.WriteLine("Exception caught in process: {0}", _Exception.ToString());
				}
			}
		}

		// Token: 0x06000025 RID: 37 RVA: 0x00003318 File Offset: 0x00001518
		private Task GetConnectedTask(ManagedMqttClient managedClient)
		{
			TaskCompletionSource<bool> connected = new TaskCompletionSource<bool>();
			managedClient.ConnectedAsync += delegate(MqttClientConnectedEventArgs arg)
			{
				connected.SetResult(true);
				return Task.CompletedTask;
			};
			return connected.Task;
		}

		// Token: 0x06000026 RID: 38 RVA: 0x00003354 File Offset: 0x00001554
		public static async Task ConnectMQTTAsync(ManagedMqttClient mqttClient, CancellationToken token, string mqtturl, string clientId, string mqttuser, string mqttpassw)
		{
			bool flag = true;
			MqttClientOptionsBuilder messageBuilder = new MqttClientOptionsBuilder().WithClientId(clientId).WithCredentials(mqttuser, mqttpassw).WithCleanSession(true)
				.WithWebSocketServer(delegate(MqttClientWebSocketOptionsBuilder b)
				{
					b.WithUri(mqtturl);
				});
			MqttClientTlsOptions tlsOptions = new MqttClientTlsOptionsBuilder().WithSslProtocols(SslProtocols.Tls12).Build();
			MqttClientOptions options = (flag ? messageBuilder.WithTlsOptions(tlsOptions).Build() : messageBuilder.Build());
			ManagedMqttClientOptions managedOptions = new ManagedMqttClientOptionsBuilder().WithAutoReconnectDelay(TimeSpan.FromSeconds(1.0)).WithClientOptions(options).Build();
			await mqttClient.StartAsync(managedOptions);
		}

		// Token: 0x06000027 RID: 39 RVA: 0x000033BC File Offset: 0x000015BC
		public static async Task PublishMQTTAsync(ManagedMqttClient mqttClient, CancellationToken token, string topic, string payload, bool retainFlag = true, int qos = 1)
		{
			await mqttClient.EnqueueAsync(topic, payload, (MqttQualityOfServiceLevel)qos, retainFlag);
			SpinWait.SpinUntil(() => mqttClient.PendingApplicationMessagesCount == 0, 5000);
		}

		// Token: 0x06000028 RID: 40 RVA: 0x00003424 File Offset: 0x00001624
		public bool OSIsUnix()
		{
			int p = (int)Environment.OSVersion.Platform;
			return p == 4 || p == 6 || p == 128;
		}

		// Token: 0x04000001 RID: 1
		private int DPortBufSize;

		// Token: 0x04000002 RID: 2
		public byte[] DPort_rxbuf;

		// Token: 0x04000003 RID: 3
		public List<byte[]> FrameList = new List<byte[]>();

		// Token: 0x04000004 RID: 4
		public List<byte> m_ResponseByteList = new List<byte>();

		// Token: 0x04000005 RID: 5
		private bool m_fstart = true;

		// Token: 0x04000006 RID: 6
		private bool m_storestart;

		// Token: 0x04000007 RID: 7
		private bool m_storeend;

		// Token: 0x04000008 RID: 8
		public string m_strTimestamp;

		// Token: 0x04000009 RID: 9
		public byte m_parametertype;

		// Token: 0x0400000A RID: 10
		private bool m_transmissionstart = true;

		// Token: 0x0400000B RID: 11
		public bool m_transmissionstart2 = true;

		// Token: 0x0400000C RID: 12
		public List<DSerialPort.NumericValResult> m_NumericValList = new List<DSerialPort.NumericValResult>();

		// Token: 0x0400000D RID: 13
		public List<string> m_NumValHeaders = new List<string>();

		// Token: 0x0400000E RID: 14
		public StringBuilder m_strbuildvalues = new StringBuilder();

		// Token: 0x0400000F RID: 15
		public StringBuilder m_strbuildheaders = new StringBuilder();

		// Token: 0x04000010 RID: 16
		public int m_dataexportset = 1;

		// Token: 0x04000011 RID: 17
		public string m_DeviceID;

		// Token: 0x04000012 RID: 18
		public string m_jsonposturl;

		// Token: 0x04000013 RID: 19
		public string m_MQTTUrl;

		// Token: 0x04000014 RID: 20
		public string m_MQTTtopic;

		// Token: 0x04000015 RID: 21
		public string m_MQTTuser;

		// Token: 0x04000016 RID: 22
		public string m_MQTTpassw;

		// Token: 0x04000017 RID: 23
		public string m_MQTTclientId = Guid.NewGuid().ToString();

		// Token: 0x04000019 RID: 25
		public CancellationTokenSource m_cancellationTokenSource = new CancellationTokenSource();

		// Token: 0x0400001A RID: 26
		private static volatile DSerialPort DPort;

		// Token: 0x02000008 RID: 8
		// (Invoke) Token: 0x06000038 RID: 56
		public delegate void DataReceivedEventHandler(object sender, EventArgs e);

		// Token: 0x02000009 RID: 9
		public class NumericValResult
		{
			// Token: 0x0400002C RID: 44
			public string Timestamp;

			// Token: 0x0400002D RID: 45
			public string PhysioID;

			// Token: 0x0400002E RID: 46
			public string Value;

			// Token: 0x0400002F RID: 47
			public string DeviceID;
		}
	}
}
