using System;

namespace VSCaptureDrgInf
{
	// Token: 0x02000004 RID: 4
	public static class DataConstants
	{
		// Token: 0x0400001B RID: 27
		public const byte SYNC_BYTE = 165;

		// Token: 0x0400001C RID: 28
		public static byte[] poll_request_software_id_status_request = new byte[] { 165, 2, 0, 80 };

		// Token: 0x0400001D RID: 29
		public static byte[] poll_request_demographics = new byte[] { 165, 2, 0, 86 };

		// Token: 0x0400001E RID: 30
		public static byte[] poll_request_parameter_data = new byte[] { 165, 2, 0, 87 };

		// Token: 0x0400001F RID: 31
		public static byte[] poll_request_parameter_data_format = new byte[] { 165, 2, 0, 119 };

		// Token: 0x02000013 RID: 19
		public enum ParameterID : ushort
		{
			// Token: 0x0400005A RID: 90
			OverRange = 16,
			// Token: 0x0400005B RID: 91
			UnderRange,
			// Token: 0x0400005C RID: 92
			Undetermined,
			// Token: 0x0400005D RID: 93
			Artifact = 20,
			// Token: 0x0400005E RID: 94
			Asystole = 5
		}

		// Token: 0x02000014 RID: 20
		public enum AgentStatus : ushort
		{
			// Token: 0x04000060 RID: 96
			Unknown_Agent = 21,
			// Token: 0x04000061 RID: 97
			Mixed_Agent = 23,
			// Token: 0x04000062 RID: 98
			Desflurane = 159,
			// Token: 0x04000063 RID: 99
			Sevoflurane = 162,
			// Token: 0x04000064 RID: 100
			Halothane = 165,
			// Token: 0x04000065 RID: 101
			Enflurane = 168,
			// Token: 0x04000066 RID: 102
			Isoflurane = 171
		}

		// Token: 0x02000015 RID: 21
		public enum GasCombination : ushort
		{
			// Token: 0x04000068 RID: 104
			O2_N2O = 185,
			// Token: 0x04000069 RID: 105
			O2_Air
		}

		// Token: 0x02000016 RID: 22
		public enum BreathingCircuit : ushort
		{
			// Token: 0x0400006B RID: 107
			CLOSED = 1,
			// Token: 0x0400006C RID: 108
			SEMI_CL,
			// Token: 0x0400006D RID: 109
			OPEN
		}

		// Token: 0x02000017 RID: 23
		public enum VentilationMode : ushort
		{
			// Token: 0x0400006F RID: 111
			HAND = 1,
			// Token: 0x04000070 RID: 112
			VCTRL,
			// Token: 0x04000071 RID: 113
			PSUP,
			// Token: 0x04000072 RID: 114
			VSUP,
			// Token: 0x04000073 RID: 115
			PCTRL,
			// Token: 0x04000074 RID: 116
			PRVC
		}

		// Token: 0x02000018 RID: 24
		public enum ParameterCode : ushort
		{
			// Token: 0x04000076 RID: 118
			HR = 1,
			// Token: 0x04000077 RID: 119
			ARR1,
			// Token: 0x04000078 RID: 120
			ARR2,
			// Token: 0x04000079 RID: 121
			PVC,
			// Token: 0x0400007A RID: 122
			AYS,
			// Token: 0x0400007B RID: 123
			VF,
			// Token: 0x0400007C RID: 124
			VT,
			// Token: 0x0400007D RID: 125
			RUN,
			// Token: 0x0400007E RID: 126
			AIVR,
			// Token: 0x0400007F RID: 127
			CPT,
			// Token: 0x04000080 RID: 128
			BGM,
			// Token: 0x04000081 RID: 129
			TACH,
			// Token: 0x04000082 RID: 130
			BRDY,
			// Token: 0x04000083 RID: 131
			PAUS,
			// Token: 0x04000084 RID: 132
			SVT,
			// Token: 0x04000085 RID: 133
			APN = 19,
			// Token: 0x04000086 RID: 134
			ARFT,
			// Token: 0x04000087 RID: 135
			AgType = 24,
			// Token: 0x04000088 RID: 136
			BIS,
			// Token: 0x04000089 RID: 137
			SQI,
			// Token: 0x0400008A RID: 138
			ENG,
			// Token: 0x0400008B RID: 139
			BSR,
			// Token: 0x0400008C RID: 140
			SEF,
			// Token: 0x0400008D RID: 141
			TPOW,
			// Token: 0x0400008E RID: 142
			ART_S = 32,
			// Token: 0x0400008F RID: 143
			ART_D,
			// Token: 0x04000090 RID: 144
			ART_M,
			// Token: 0x04000091 RID: 145
			P_ART_S,
			// Token: 0x04000092 RID: 146
			P_ART_D,
			// Token: 0x04000093 RID: 147
			P_ART_M,
			// Token: 0x04000094 RID: 148
			RV_S,
			// Token: 0x04000095 RID: 149
			RV_D,
			// Token: 0x04000096 RID: 150
			RV_M,
			// Token: 0x04000097 RID: 151
			LV_S,
			// Token: 0x04000098 RID: 152
			LV_D,
			// Token: 0x04000099 RID: 153
			LV_M,
			// Token: 0x0400009A RID: 154
			RA,
			// Token: 0x0400009B RID: 155
			LA,
			// Token: 0x0400009C RID: 156
			CVP,
			// Token: 0x0400009D RID: 157
			ICP,
			// Token: 0x0400009E RID: 158
			CPP,
			// Token: 0x0400009F RID: 159
			GenP1_S,
			// Token: 0x040000A0 RID: 160
			GenP1_D,
			// Token: 0x040000A1 RID: 161
			GenP1_M,
			// Token: 0x040000A2 RID: 162
			GenP2_S,
			// Token: 0x040000A3 RID: 163
			GenP2_D,
			// Token: 0x040000A4 RID: 164
			GenP2_M,
			// Token: 0x040000A5 RID: 165
			P1a_S,
			// Token: 0x040000A6 RID: 166
			P1a_D,
			// Token: 0x040000A7 RID: 167
			P1a_M,
			// Token: 0x040000A8 RID: 168
			P1b_S,
			// Token: 0x040000A9 RID: 169
			P1b_D,
			// Token: 0x040000AA RID: 170
			P1b_M,
			// Token: 0x040000AB RID: 171
			P1c_S,
			// Token: 0x040000AC RID: 172
			P1c_D,
			// Token: 0x040000AD RID: 173
			P1c_M,
			// Token: 0x040000AE RID: 174
			P1d_S,
			// Token: 0x040000AF RID: 175
			P1d_D,
			// Token: 0x040000B0 RID: 176
			P1d_M,
			// Token: 0x040000B1 RID: 177
			P2a_S,
			// Token: 0x040000B2 RID: 178
			P2a_D,
			// Token: 0x040000B3 RID: 179
			P2a_M,
			// Token: 0x040000B4 RID: 180
			P2b_S,
			// Token: 0x040000B5 RID: 181
			P2b_D,
			// Token: 0x040000B6 RID: 182
			P2b_M,
			// Token: 0x040000B7 RID: 183
			P2c_S,
			// Token: 0x040000B8 RID: 184
			P2c_D,
			// Token: 0x040000B9 RID: 185
			P2c_M,
			// Token: 0x040000BA RID: 186
			P2d_S,
			// Token: 0x040000BB RID: 187
			P2d_D,
			// Token: 0x040000BC RID: 188
			P2d_M,
			// Token: 0x040000BD RID: 189
			P3a_S,
			// Token: 0x040000BE RID: 190
			P3a_D,
			// Token: 0x040000BF RID: 191
			P3a_M,
			// Token: 0x040000C0 RID: 192
			P3b_S,
			// Token: 0x040000C1 RID: 193
			P3b_D,
			// Token: 0x040000C2 RID: 194
			P3b_M,
			// Token: 0x040000C3 RID: 195
			P3c_S,
			// Token: 0x040000C4 RID: 196
			P3c_D,
			// Token: 0x040000C5 RID: 197
			P3c_M,
			// Token: 0x040000C6 RID: 198
			P3d_S,
			// Token: 0x040000C7 RID: 199
			P3d_D,
			// Token: 0x040000C8 RID: 200
			P3d_M,
			// Token: 0x040000C9 RID: 201
			NIBP_S,
			// Token: 0x040000CA RID: 202
			NIBP_D,
			// Token: 0x040000CB RID: 203
			NIBP_M,
			// Token: 0x040000CC RID: 204
			PAWP,
			// Token: 0x040000CD RID: 205
			Resp = 96,
			// Token: 0x040000CE RID: 206
			IBP_S,
			// Token: 0x040000CF RID: 207
			IBP_D,
			// Token: 0x040000D0 RID: 208
			IBP_M,
			// Token: 0x040000D1 RID: 209
			SPO2,
			// Token: 0x040000D2 RID: 210
			PLS,
			// Token: 0x040000D3 RID: 211
			RRc,
			// Token: 0x040000D4 RID: 212
			ETCO2,
			// Token: 0x040000D5 RID: 213
			RRCal,
			// Token: 0x040000D6 RID: 214
			InCO2,
			// Token: 0x040000D7 RID: 215
			Tempb = 111,
			// Token: 0x040000D8 RID: 216
			TV,
			// Token: 0x040000D9 RID: 217
			TV_I,
			// Token: 0x040000DA RID: 218
			TV_E,
			// Token: 0x040000DB RID: 219
			MV,
			// Token: 0x040000DC RID: 220
			MV_I,
			// Token: 0x040000DD RID: 221
			MV_E,
			// Token: 0x040000DE RID: 222
			MAP,
			// Token: 0x040000DF RID: 223
			PIP,
			// Token: 0x040000E0 RID: 224
			EEP,
			// Token: 0x040000E1 RID: 225
			RRv,
			// Token: 0x040000E2 RID: 226
			PEEP,
			// Token: 0x040000E3 RID: 227
			PAUSE,
			// Token: 0x040000E4 RID: 228
			InO2 = 126,
			// Token: 0x040000E5 RID: 229
			Delta_T,
			// Token: 0x040000E6 RID: 230
			Temp_a,
			// Token: 0x040000E7 RID: 231
			Temp_1a,
			// Token: 0x040000E8 RID: 232
			Temp_1b,
			// Token: 0x040000E9 RID: 233
			Delta_T1,
			// Token: 0x040000EA RID: 234
			Temp_2a,
			// Token: 0x040000EB RID: 235
			Temp_2b,
			// Token: 0x040000EC RID: 236
			Delta_T2,
			// Token: 0x040000ED RID: 237
			Temp_3a,
			// Token: 0x040000EE RID: 238
			Temp_3b,
			// Token: 0x040000EF RID: 239
			Delta_T3,
			// Token: 0x040000F0 RID: 240
			Blood_T,
			// Token: 0x040000F1 RID: 241
			CO,
			// Token: 0x040000F2 RID: 242
			ICO,
			// Token: 0x040000F3 RID: 243
			CCO,
			// Token: 0x040000F4 RID: 244
			SVR,
			// Token: 0x040000F5 RID: 245
			Inj_T,
			// Token: 0x040000F6 RID: 246
			O2,
			// Token: 0x040000F7 RID: 247
			IO2,
			// Token: 0x040000F8 RID: 248
			FiO2,
			// Token: 0x040000F9 RID: 249
			etO2,
			// Token: 0x040000FA RID: 250
			CO2,
			// Token: 0x040000FB RID: 251
			ICO2,
			// Token: 0x040000FC RID: 252
			etCO2,
			// Token: 0x040000FD RID: 253
			PerECO2,
			// Token: 0x040000FE RID: 254
			PerICO2,
			// Token: 0x040000FF RID: 255
			N2O,
			// Token: 0x04000100 RID: 256
			InN2O,
			// Token: 0x04000101 RID: 257
			etN2O,
			// Token: 0x04000102 RID: 258
			AG,
			// Token: 0x04000103 RID: 259
			InAG,
			// Token: 0x04000104 RID: 260
			etAG,
			// Token: 0x04000105 RID: 261
			Des,
			// Token: 0x04000106 RID: 262
			InDES,
			// Token: 0x04000107 RID: 263
			etDES,
			// Token: 0x04000108 RID: 264
			SEV,
			// Token: 0x04000109 RID: 265
			InSEV,
			// Token: 0x0400010A RID: 266
			etSEV,
			// Token: 0x0400010B RID: 267
			HAL,
			// Token: 0x0400010C RID: 268
			InHAL,
			// Token: 0x0400010D RID: 269
			etHAL,
			// Token: 0x0400010E RID: 270
			ENF,
			// Token: 0x0400010F RID: 271
			InENF,
			// Token: 0x04000110 RID: 272
			etENF,
			// Token: 0x04000111 RID: 273
			ISO,
			// Token: 0x04000112 RID: 274
			InISO,
			// Token: 0x04000113 RID: 275
			etISO,
			// Token: 0x04000114 RID: 276
			WLO2 = 176,
			// Token: 0x04000115 RID: 277
			WLN2O,
			// Token: 0x04000116 RID: 278
			WIAIR,
			// Token: 0x04000117 RID: 279
			TkO2,
			// Token: 0x04000118 RID: 280
			TkN2O,
			// Token: 0x04000119 RID: 281
			TkAIR,
			// Token: 0x0400011A RID: 282
			FGO2 = 189,
			// Token: 0x0400011B RID: 283
			FGN2O,
			// Token: 0x0400011C RID: 284
			FGAIR,
			// Token: 0x0400011D RID: 285
			ST,
			// Token: 0x0400011E RID: 286
			STI,
			// Token: 0x0400011F RID: 287
			STII,
			// Token: 0x04000120 RID: 288
			STIII,
			// Token: 0x04000121 RID: 289
			STAVL,
			// Token: 0x04000122 RID: 290
			STAVR,
			// Token: 0x04000123 RID: 291
			STAVF,
			// Token: 0x04000124 RID: 292
			STV,
			// Token: 0x04000125 RID: 293
			STVp,
			// Token: 0x04000126 RID: 294
			STV3,
			// Token: 0x04000127 RID: 295
			STV4,
			// Token: 0x04000128 RID: 296
			STV5,
			// Token: 0x04000129 RID: 297
			TPO2,
			// Token: 0x0400012A RID: 298
			TPCO2,
			// Token: 0x0400012B RID: 299
			TcPO2,
			// Token: 0x0400012C RID: 300
			TcPCO2,
			// Token: 0x0400012D RID: 301
			SVO2,
			// Token: 0x0400012E RID: 302
			SAO2,
			// Token: 0x0400012F RID: 303
			BT,
			// Token: 0x04000130 RID: 304
			CCI,
			// Token: 0x04000131 RID: 305
			ICI,
			// Token: 0x04000132 RID: 306
			SVRI,
			// Token: 0x04000133 RID: 307
			DO2,
			// Token: 0x04000134 RID: 308
			VO2,
			// Token: 0x04000135 RID: 309
			STV6,
			// Token: 0x04000136 RID: 310
			STVM,
			// Token: 0x04000137 RID: 311
			STVCM,
			// Token: 0x04000138 RID: 312
			GasCom,
			// Token: 0x04000139 RID: 313
			INSPT,
			// Token: 0x0400013A RID: 314
			Insp,
			// Token: 0x0400013B RID: 315
			BC,
			// Token: 0x0400013C RID: 316
			VentMode,
			// Token: 0x0400013D RID: 317
			EEG1,
			// Token: 0x0400013E RID: 318
			EEG2,
			// Token: 0x0400013F RID: 319
			EEG3,
			// Token: 0x04000140 RID: 320
			EEG4,
			// Token: 0x04000141 RID: 321
			EEGMF,
			// Token: 0x04000142 RID: 322
			EEGSEF,
			// Token: 0x04000143 RID: 323
			EEGTP,
			// Token: 0x04000144 RID: 324
			EEG_B,
			// Token: 0x04000145 RID: 325
			EEG_A,
			// Token: 0x04000146 RID: 326
			EEG_T,
			// Token: 0x04000147 RID: 327
			EEG_D,
			// Token: 0x04000148 RID: 328
			EEGBSR,
			// Token: 0x04000149 RID: 329
			Time = 242,
			// Token: 0x0400014A RID: 330
			Exp = 244,
			// Token: 0x0400014B RID: 331
			SpO2 = 247,
			// Token: 0x0400014C RID: 332
			DSpO2,
			// Token: 0x0400014D RID: 333
			P_PLS,
			// Token: 0x0400014E RID: 334
			Tvi_m = 65025,
			// Token: 0x0400014F RID: 335
			Tvi_s,
			// Token: 0x04000150 RID: 336
			Tvalv_m,
			// Token: 0x04000151 RID: 337
			Tvalv_s,
			// Token: 0x04000152 RID: 338
			Mvalv_m,
			// Token: 0x04000153 RID: 339
			Mvalv_s,
			// Token: 0x04000154 RID: 340
			TVd_aw,
			// Token: 0x04000155 RID: 341
			Cdyn,
			// Token: 0x04000156 RID: 342
			C20CDY,
			// Token: 0x04000157 RID: 343
			Raw_e,
			// Token: 0x04000158 RID: 344
			Raw_i,
			// Token: 0x04000159 RID: 345
			PIF = 65038,
			// Token: 0x0400015A RID: 346
			PEF,
			// Token: 0x0400015B RID: 347
			EtLeak,
			// Token: 0x0400015C RID: 348
			Tve_m,
			// Token: 0x0400015D RID: 349
			Tve_s,
			// Token: 0x0400015E RID: 350
			MVe_m,
			// Token: 0x0400015F RID: 351
			MVe_s,
			// Token: 0x04000160 RID: 352
			RRm,
			// Token: 0x04000161 RID: 353
			RRs,
			// Token: 0x04000162 RID: 354
			RSBI = 65048,
			// Token: 0x04000163 RID: 355
			VCO2,
			// Token: 0x04000164 RID: 356
			TVCO2,
			// Token: 0x04000165 RID: 357
			TValv,
			// Token: 0x04000166 RID: 358
			MValv,
			// Token: 0x04000167 RID: 359
			PeCO2,
			// Token: 0x04000168 RID: 360
			TVdaw,
			// Token: 0x04000169 RID: 361
			Ti,
			// Token: 0x0400016A RID: 362
			Te,
			// Token: 0x0400016B RID: 363
			STd1,
			// Token: 0x0400016C RID: 364
			STd3,
			// Token: 0x0400016D RID: 365
			STd4,
			// Token: 0x0400016E RID: 366
			STd6,
			// Token: 0x0400016F RID: 367
			MAC,
			// Token: 0x04000170 RID: 368
			BCT,
			// Token: 0x04000171 RID: 369
			NMTAmp,
			// Token: 0x04000172 RID: 370
			NMTS,
			// Token: 0x04000173 RID: 371
			NMTTOFR,
			// Token: 0x04000174 RID: 372
			NMTTOFC = 65072,
			// Token: 0x04000175 RID: 373
			NMTPTC,
			// Token: 0x04000176 RID: 374
			NMTTemp
		}

		// Token: 0x02000019 RID: 25
		public enum EEGLeadLabels : ushort
		{
			// Token: 0x04000178 RID: 376
			FP = 65,
			// Token: 0x04000179 RID: 377
			FP1,
			// Token: 0x0400017A RID: 378
			FP2,
			// Token: 0x0400017B RID: 379
			FX,
			// Token: 0x0400017C RID: 380
			F3,
			// Token: 0x0400017D RID: 381
			F4,
			// Token: 0x0400017E RID: 382
			F7,
			// Token: 0x0400017F RID: 383
			F8,
			// Token: 0x04000180 RID: 384
			CZ,
			// Token: 0x04000181 RID: 385
			C3,
			// Token: 0x04000182 RID: 386
			C4,
			// Token: 0x04000183 RID: 387
			T7,
			// Token: 0x04000184 RID: 388
			T8,
			// Token: 0x04000185 RID: 389
			PZ,
			// Token: 0x04000186 RID: 390
			P3,
			// Token: 0x04000187 RID: 391
			P4,
			// Token: 0x04000188 RID: 392
			P7,
			// Token: 0x04000189 RID: 393
			P8,
			// Token: 0x0400018A RID: 394
			O,
			// Token: 0x0400018B RID: 395
			O1,
			// Token: 0x0400018C RID: 396
			O2,
			// Token: 0x0400018D RID: 397
			LEFT,
			// Token: 0x0400018E RID: 398
			RIGHT,
			// Token: 0x0400018F RID: 399
			FRONT,
			// Token: 0x04000190 RID: 400
			BACK
		}
	}
}
