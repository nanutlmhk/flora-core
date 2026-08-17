using System;
using System.IO.Ports;
using System.Threading.Tasks;

namespace VSCaptureDrgInf
{
	// Token: 0x02000005 RID: 5
	internal class ProgramDrgInf
	{
		// Token: 0x0600002D RID: 45 RVA: 0x00003504 File Offset: 0x00001704
		public static void Main(string[] args)
		{
			Console.WriteLine("VitalSignsCaptureDraegerInfinity v1.002 (C)2024-25 John George K.");
			Console.WriteLine("For command line usage: -help");
			Console.WriteLine();
			DSerialPort _serialPort = DSerialPort.getInstance;
			CommandLineParser parser = new CommandLineParser();
			parser.Parse(args);
			if (parser.Arguments.ContainsKey("help"))
			{
				Console.WriteLine("VSCaptureDrgInf.exe -port [portname] -interval [number]");
				Console.WriteLine(" -export[number] -devid[name] -url [name]");
				Console.WriteLine("-port <Set serial port name>");
				Console.WriteLine("-interval <Set numeric transmission interval>");
				Console.WriteLine("-export <Set data export CSV, MQTT or JSON option>");
				Console.WriteLine("-devid <Set device ID for MQTT or JSON export>");
				Console.WriteLine("-url <Set MQTT or JSON export url>");
				Console.WriteLine("-topic <Set topic for MQTT export>");
				Console.WriteLine("-user <Set username for MQTT export>");
				Console.WriteLine("-passw <Set password for MQTT export>");
				Console.WriteLine();
				return;
			}
			string portName;
			if (parser.Arguments.ContainsKey("port"))
			{
				portName = parser.Arguments["port"][0];
			}
			else
			{
				Console.WriteLine("Select the Port to which Draeger Delta, Kappa, Vista XL monitor (Infinity protocol) is to be connected, Available Ports:");
				foreach (string s in SerialPort.GetPortNames())
				{
					Console.WriteLine(" {0}", s);
				}
				Console.Write("COM port({0}): ", _serialPort.PortName.ToString());
				portName = Console.ReadLine();
			}
			if (portName != "")
			{
				_serialPort.PortName = portName;
			}
			try
			{
				_serialPort.StartProcessing();
				string sIntervalset;
				if (parser.Arguments.ContainsKey("interval"))
				{
					sIntervalset = parser.Arguments["interval"][0];
				}
				else
				{
					Console.WriteLine();
					Console.WriteLine("Numeric Data Transmission sets:");
					Console.WriteLine("1. 5 second");
					Console.WriteLine("2. 10 second");
					Console.WriteLine("3. 1 minute");
					Console.WriteLine("4. 5 minute");
					Console.WriteLine("5. Single poll");
					Console.WriteLine();
					Console.Write("Choose Data Transmission interval (1-5):");
					sIntervalset = Console.ReadLine();
				}
				int[] setarray = new int[] { 5, 10, 60, 300, 0 };
				short nIntervalset = 1;
				int nInterval = 5;
				if (sIntervalset != "")
				{
					nIntervalset = Convert.ToInt16(sIntervalset);
				}
				if (nIntervalset > 0 && nIntervalset < 6)
				{
					nInterval = setarray[(int)(nIntervalset - 1)];
				}
				string sDataExportset;
				if (parser.Arguments.ContainsKey("export"))
				{
					sDataExportset = parser.Arguments["export"][0];
				}
				else
				{
					Console.WriteLine();
					Console.WriteLine("Data export options:");
					Console.WriteLine("1. Export as CSV files");
					Console.WriteLine("2. Export as CSV files and JSON to URL");
					Console.WriteLine("3. Export as MQTT to URL");
					Console.WriteLine("4. Export as JSON file");
					Console.WriteLine();
					Console.Write("Choose data export option (1-4):");
					sDataExportset = Console.ReadLine();
				}
				int nDataExportset = 1;
				if (sDataExportset != "")
				{
					nDataExportset = Convert.ToInt32(sDataExportset);
				}
				if (nDataExportset == 2)
				{
					if (parser.Arguments.ContainsKey("devid"))
					{
						ProgramDrgInf.DeviceID = parser.Arguments["devid"][0];
					}
					else
					{
						Console.Write("Enter Device ID/Name:");
						ProgramDrgInf.DeviceID = Console.ReadLine();
					}
					if (parser.Arguments.ContainsKey("url"))
					{
						ProgramDrgInf.JSONPostUrl = parser.Arguments["url"][0];
					}
					else
					{
						Console.Write("Enter JSON Data Export URL(http://):");
						ProgramDrgInf.JSONPostUrl = Console.ReadLine();
					}
				}
				if (nDataExportset == 3)
				{
					if (parser.Arguments.ContainsKey("devid"))
					{
						ProgramDrgInf.DeviceID = parser.Arguments["devid"][0];
					}
					else
					{
						Console.Write("Enter Device ID/Name:");
						ProgramDrgInf.DeviceID = Console.ReadLine();
					}
					if (parser.Arguments.ContainsKey("url"))
					{
						ProgramDrgInf.MQTTUrl = parser.Arguments["url"][0];
					}
					else
					{
						Console.Write("Enter MQTT WebSocket Server URL(ws://):");
						ProgramDrgInf.MQTTUrl = Console.ReadLine();
					}
					if (parser.Arguments.ContainsKey("topic"))
					{
						ProgramDrgInf.MQTTtopic = parser.Arguments["topic"][0];
					}
					else
					{
						Console.Write("Enter MQTT Topic:");
						ProgramDrgInf.MQTTtopic = Console.ReadLine();
					}
					if (parser.Arguments.ContainsKey("user"))
					{
						ProgramDrgInf.MQTTuser = parser.Arguments["user"][0];
					}
					else
					{
						Console.Write("Enter MQTT Username:");
						ProgramDrgInf.MQTTuser = Console.ReadLine();
					}
					if (parser.Arguments.ContainsKey("passw"))
					{
						ProgramDrgInf.MQTTpassw = parser.Arguments["passw"][0];
					}
					else
					{
						Console.Write("Enter MQTT Password:");
						ProgramDrgInf.MQTTpassw = Console.ReadLine();
					}
				}
				_serialPort.m_DeviceID = ProgramDrgInf.DeviceID;
				_serialPort.m_jsonposturl = ProgramDrgInf.JSONPostUrl;
				_serialPort.m_MQTTUrl = ProgramDrgInf.MQTTUrl;
				_serialPort.m_MQTTtopic = ProgramDrgInf.MQTTtopic;
				_serialPort.m_MQTTuser = ProgramDrgInf.MQTTuser;
				_serialPort.m_MQTTpassw = ProgramDrgInf.MQTTpassw;
				if (nDataExportset > 0 && nDataExportset < 5)
				{
					_serialPort.m_dataexportset = nDataExportset;
				}
				Console.WriteLine();
				Console.WriteLine("Requesting Transmission set {0} from monitor", nIntervalset);
				Console.WriteLine();
				Console.WriteLine("Data will be written to CSV file DrgInfExportData.csv in same folder");
				_serialPort.RequestStatus();
				ProgramDrgInf.WaitForMilliSeconds(200);
				Task.Run(() => _serialPort.SendCycledRequests(nInterval));
				Console.WriteLine("Press Escape button to Stop");
				ProgramDrgInf.WaitForExit();
			}
			catch (Exception ex)
			{
				Console.WriteLine("Error opening/writing to serial port :: " + ex.Message, "Error!");
			}
			finally
			{
				_serialPort.StopTransfer();
				_serialPort.Close();
			}
		}

		// Token: 0x0600002E RID: 46 RVA: 0x00003AC0 File Offset: 0x00001CC0
		public static void WaitForMilliSeconds(int nmillisec)
		{
			DateTime dt2 = DateTime.Now.AddMilliseconds((double)nmillisec);
			DateTime dt3;
			do
			{
				dt3 = DateTime.Now;
			}
			while (dt2 > dt3);
		}

		// Token: 0x0600002F RID: 47 RVA: 0x00003AEC File Offset: 0x00001CEC
		public static void WaitForExit()
		{
			if (ProgramDrgInf.OSIsUnix())
			{
				while ((!Console.KeyAvailable || Console.ReadKey(true).Key != ConsoleKey.Escape) && !Console.KeyAvailable)
				{
				}
			}
			if (!ProgramDrgInf.OSIsUnix())
			{
				while (Console.ReadKey(true).Key != ConsoleKey.Escape)
				{
				}
			}
		}

		// Token: 0x06000030 RID: 48 RVA: 0x00003B3C File Offset: 0x00001D3C
		public static bool OSIsUnix()
		{
			int p = (int)Environment.OSVersion.Platform;
			return p == 4 || p == 6 || p == 128;
		}

		// Token: 0x04000020 RID: 32
		public static string DeviceID;

		// Token: 0x04000021 RID: 33
		public static string JSONPostUrl;

		// Token: 0x04000022 RID: 34
		public static string MQTTUrl;

		// Token: 0x04000023 RID: 35
		public static string MQTTtopic;

		// Token: 0x04000024 RID: 36
		public static string MQTTuser;

		// Token: 0x04000025 RID: 37
		public static string MQTTpassw;
	}
}
