using System;
using System.Collections.Generic;

namespace VSCaptureDrgInf
{
	// Token: 0x02000006 RID: 6
	public class CommandLineParser
	{
		// Token: 0x06000032 RID: 50 RVA: 0x00003B6F File Offset: 0x00001D6F
		public CommandLineParser()
		{
			this.Arguments = new Dictionary<string, string[]>();
		}

		// Token: 0x17000002 RID: 2
		// (get) Token: 0x06000033 RID: 51 RVA: 0x00003B82 File Offset: 0x00001D82
		// (set) Token: 0x06000034 RID: 52 RVA: 0x00003B8A File Offset: 0x00001D8A
		public IDictionary<string, string[]> Arguments { get; private set; }

		// Token: 0x06000035 RID: 53 RVA: 0x00003B94 File Offset: 0x00001D94
		public void Parse(string[] args)
		{
			string currentName = "";
			List<string> values = new List<string>();
			foreach (string arg in args)
			{
				if (arg.StartsWith("-", StringComparison.InvariantCulture))
				{
					if (currentName != "" && values.Count != 0)
					{
						this.Arguments[currentName] = values.ToArray();
					}
					else
					{
						values.Add("");
						this.Arguments[currentName] = values.ToArray();
					}
					values.Clear();
					currentName = arg.Substring(1);
				}
				else if (currentName == "")
				{
					this.Arguments[arg] = new string[0];
				}
				else
				{
					values.Add(arg);
				}
			}
			if (currentName != "")
			{
				this.Arguments[currentName] = values.ToArray();
			}
		}

		// Token: 0x06000036 RID: 54 RVA: 0x00003C77 File Offset: 0x00001E77
		public bool Contains(string name)
		{
			return this.Arguments.ContainsKey(name);
		}
	}
}
