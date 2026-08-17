using System;

namespace VSCaptureDrgInf
{
	// Token: 0x02000002 RID: 2
	public class Crc
	{
		// Token: 0x06000001 RID: 1 RVA: 0x00002050 File Offset: 0x00000250
		public byte ComputeChecksum(byte[] bytes)
		{
			byte sum = 0;
			for (int i = 0; i < bytes.Length; i++)
			{
				sum += bytes[i];
			}
			return sum & byte.MaxValue;
		}
	}
}
