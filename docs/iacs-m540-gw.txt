require 'socket'
require 'net/http'
require 'json'
require "ipaddr"
require_relative 'config/m540_cfg'
require_relative 'iacs-lib'




# BIND_ADDR_LOCAL = "191.1.1.5"

# BIND_ADDR_LOCAL = "172.28.5.151"

# BIND_ADDR_LOCAL = "10.50.0.193"


# M540 data on this port

puts 'hi'

module Device


  def self.add_monitor socket, ip


    # M540_MULTICAST_ADDR = "224.0.1.10"  # to receive data
    #
    # M540_BIND_ADDR_LOCAL = "10.50.0.5"

    mip = "224.0.1.#{ip.split(".")[-1]}"



    membership = IPAddr.new(mip).hton + IPAddr.new(M540_BIND_ADDR_LOCAL).hton


    puts 'Start Receive Data : ' + ip
    socket.setsockopt(:IPPROTO_IP, :IP_ADD_MEMBERSHIP, membership)
    # socket.setsockopt(:SOL_SOCKET, :SO_REUSEPORT, 1)


  end


  def self.etabular data, cols = 20 , out = STDOUT


    data.each_with_index do |i,index|

      out.print "#{index}," if index % cols == 0

      out.print "#{i},"

      out.puts if index % cols == cols -1

    end

    out.puts 

  end

  def self.start_monitor socket, ws, queue

    #========================================================================================
    #========================================================================================
    #========================================================================================

    # M540_MULTICAST_ADDR = "224.0.1.10"  # to receive data
    #
    # M540_BIND_ADDR_LOCAL = "10.50.0.5"

    # mip = "224.0.1.#{ip.split(".")[-1]}"



    # membership = IPAddr.new(mip).hton + IPAddr.new(M540_BIND_ADDR_LOCAL).hton
    #
    #
    # puts 'Start Sent Data : ' + ip
    # socket.setsockopt(:IPPROTO_IP, :IP_ADD_MEMBERSHIP, membership)
    # socket.setsockopt(:SOL_SOCKET, :SO_REUSEPORT, 1)

    # open port
    socket.bind('0.0.0.0', M540_PORT)


    # host = GW_IP
    # port = GW_PORT
    # uri = GW_URI



    station_msg = nil
    cout = {}


    mout = {}
    #    %w{622 886 1060 1406 1428}.each do |i|
    #    eout = File.open('out-'+i+'.txt','w')  
    #   mout[i.to_i] = eout
    #end

    lbuff = {}
    vs =  {}

    devices = {}


    change = {}



    response = true

    while true do

      begin

        message, info = socket.recvfrom(6096)
        l = message.each_byte.to_a.collect{|i| i.to_i}  

        device_id = info[2]
        
        devices[device_id] = {:name=>device_id.gsub('.','-'),:id=>device_id,:wbuff=>[],:vs=>{},:lbuff=>{}} unless devices[device_id] 
        
        
        if  true or device_id=='191.1.2.11'
          
        device = devices[device_id]
        vs = device[:vs]
        lbuff = device[:lbuff]
        wbuff = device[:wbuff]
        # lead data package

        # if false and l.size == 602
 #
 #        l.each_with_index do |y,x|
 #
 #        change[x] = {} unless change[x]
 #        change[x][y] = 1 unless change[x][y]
 #
 #        end
 #
 #        change.keys.sort.each do |x|
 #          puts "#{x}\t#{change[x].keys.join("\t")}" if change[x].keys.size>1
 #        end
 #
 #        end




        map = IACS::parser l
        
      
        

        m = map
        #	puts device_id
        if false #or device_id=='191.1.2.11'
          
          puts "="*30
          puts l.size
          map.keys.sort.each do |i|
            #puts i
            if map[i].class==Array
           # puts "#{i}\t#{map[i].size}"
          else
            puts "#{i}\t#{map[i].inspect.to_s }"
            
            end
          end 
          puts
        end
        

	#puts m.keys.collect{|i| "#{i} = #{m[i]}"}.join("\n")
        
        true_hr = nil
      
        # true_hr =  m['1-4-0-0-26'] if m['1-4-0-0-26'] and  m['1-4-0-0-26'] > 10
#         true_hr =  m['1-4-0-1-26'] if m['1-4-0-1-26']  and  m['1-4-0-1-26'] > 10
#         true_hr =  m['1-112-0-1-2'] if m['1-112-0-1-2'] and  m['1-112-0-1-2'] > 10
#         true_hr =  m['6-9-0-0-9'] if m['6-9-0-0-9'] and  m['6-9-0-0-9'] > 10
#

          
          
       vs[:hr] = m['1-1-0-0-26'] if m['1-1-0-0-26']
          
       vs[:hr] = m['1-1-0-1-26'] if m['1-1-0-1-26']

        #vs[:hr] = '-' unless vs[:hr]

        vs[:pr] = m['25-5-0-0-26'] if m['25-5-0-0-26']
        vs[:pr] = m['25-5-0-1-26'] if m['25-5-0-1-26']   
        # vs[:pr] = m['25-255-0-0-28'] if m['25-255-0-0-28'] and m['25-255-0-0-28'] >10
        # vs[:pr] = m['30-7-0-0-9'] if m['30-7-0-0-9'] and ( m['30-7-0-0-9'] - vs[:hr] ).abs < (vs[:pr]-vs[:hr]).abs

      #  vs[:pr] = '-' unless vs[:pr]

     #   vs[:spo2] = nil
        #vs[:spo2] = m['1-3-1-0-30'] if m['1-3-1-0-30'] and m['1-3-1-0-30'] > 10 
        #vs[:spo2] = m['1-191-0-1-2'] if m['1-191-0-1-2'] and m['1-191-0-1-2']>10
        #vs[:spo2] = m['25-5-0-0-26'] if m['25-5-0-0-26']   
        #vs[:spo2] = m['25-5-0-1-26'] /2 if m['25-5-0-1-26']
	      
        vs[:spo2] = m['25-14-0-1-28'] if m['25-14-0-1-28']
        vs[:spo2] = m['25-14-0-0-28'] if m['25-14-0-0-28']
        
        vs[:co2] = (m['31-15-0-1-9']/10.0).round if m['31-15-0-1-9']
        vs[:co2] = (m['31-15-0-0-9']/10.0).round if m['31-15-0-0-9']
        
        
      
        #vs[:spo2] = '-' unless vs[:spo2]
        
        vs[:rr] = m['2-6-0-1-27'] if m['2-6-0-1-27']
        vs[:rr] = m['94-120-0-0-66'] if m['94-120-0-0-66']
        vs[:rr_pmean] = (m['94-113-0-0-66']/10.0).round if m['94-113-0-0-66']
        vs[:rr_pip] = (m['94-123-0-0-27']/10.0).round if m['94-123-0-0-27']
        vs[:vte] = m['94-125-0-0-66']


        bp_sys = vs[:bp_sys]
        bp_dia = vs[:bp_dia]



        # bp_sys = (m['30-9-0-0-9']/10.0).round if m['30-9-0-0-9']
#         bp_sys = (m['1-2-0-0-28']/10.0).round if m['1-2-0-0-28']
#         bp_sys = (m['1-2-1-0-28']/10.0).round if m['1-2-1-0-28']
#         bp_sys = (m['1-1-0-0-26']/10.0).round if m['1-1-0-0-26'] and m['1-1-0-0-26'] > 10
#         bp_sys =  (m['31-6-0-1-27']/10.0).round if m['31-6-0-1-27']
#
        bp_sys = (m['30-8-0-0-9']/10.0).round if m['30-8-0-0-9']
        bp_sys = (m['30-8-0-1-9']/10.0).round if m['30-8-0-1-9']
        
#bp_sys = (m['25-5-1-1-26']/10.0).round if m['25-5-1-1-26']
	#puts m.inspect 

#	puts "************#{ m['25-5-1-1-26'].inspect}"

        
        
        bp_dia = (m['30-7-0-0-9']/10.0).round if m['30-7-0-0-9']
        bp_dia = (m['30-7-0-1-9']/10.0).round if m['30-7-0-1-9']


	

        vs[:bp_sys] = bp_sys
        vs[:bp_dia] = bp_dia

        vs[:bp_mean] = (m['30-9-0-0-9']/10.0).round if m['30-9-0-0-9']
        vs[:bp_mean] = (m['30-9-0-1-9']/10.0).round if m['30-9-0-1-9']


        vs[:bp] = "#{bp_sys}/#{bp_dia}"

	#vs[:temp] = (m['1-104-0-1-2']/10.0) if m['1-104-0-1-2']

	vs[:temp] = (m['26-11-0-1-17']/10.0) if m['26-11-0-1-17']


        vs[:msg] = m['msg'] if m['msg']
        #	puts map.keys.sort.inspect

        t = 16
# 1-34 1-36

        # lx = %w{6-1 25-22 1-2 1-3 1-4 1-34 1-36 1-37 1-40 1-43 1-45 1-46 1-48 95-54 95-55 95-57}
        lx = %w{31-1 25-22 6-1 1-2 1-3 1-4 1-34 1-36 1-37 1-40 1-43 1-45 1-46 1-48 95-54 95-55 }
        

        now = Time.now 
        stamp = now.to_json
        bp_stamp = now

        ref = '-'


        lx.each_with_index do |j, jindex|


          wave = map[j]
          wave = map['2-1'] if j=='6-1' and map['6-1'] ==nil

          #puts wave.inspect if j=='6-1'

          lbuff[jindex] = [] unless lbuff[jindex]

          if wave
            lbuff[jindex] += wave 

          end

        end
        #	puts "#{lbuff.collect{|c| c[1].size}.join(",")}"

        if lbuff[3].size>=200        

          #          puts "#{lbuff.collect{|c| c[1].size}.join(" ")}"
          data = {}

          data[:leads] = {}

          (t+1).times do |j|

            data[:leads][j] = lbuff[j].shift(200) if lbuff[j]

          end

          peak = []
          
          
          
          
          # change[device_id] = change[device_id][..]
          
          
          if false
            
          change[device_id] = [] unless change[device_id]
          
          change[device_id].collect!{|x| [x[0]-200,x[1]] }
            
          
          l3 = data[:leads][3]
          198.times do |x|
            if l3[x]>500 and l3[x+1]<l3[x]-10 and l3[x-1]<l3[x]-10 
              # puts "#{l3[x-1]} #{l3[x]} #{l3[x+1]}"
              peak << "(#{x} #{l3[x]})"
              change[device_id] << [x,l3[x]]
            end
          end
         
          # puts "Found #{peak.join(", ")}" if peak.size>0
          
          # puts change[device_id].collect{|x| x[0]}
          n = 9
          if change[device_id].size > n
            a = change[device_id]
            mode = []
            n.times do |x|
              
              dif = a[-x-1][0] - a[-x-2][0] 
              # puts dif
              hr = 60.0/dif*200
              mode << hr
              
            end
            mode.sort!
            # puts mode.join(", ")
            hr = mode[n/2].ceil
            # hr = mode[0].to_i
            
                
            # puts "HR : #{hr}"
            vs[:hr] = hr unless true_hr
            
            change[device_id] = change[device_id][-n..-1]
          end
         
         end
         
         
         # vs[:hr] = true_hr if true_hr
           # puts vs[:hr]     
         
         
          # puts map['wave_key'].inspect

          # data[:wave] = wbuff.shift(25)
          #data[:wave] =  data[:leads][0]

          data.merge! vs


          # data[:temp] = '-'
          # data[:rr] = '-' 

          data[:bp_stamp] = bp_stamp.strftime("%H%M%S")

          name = device[:name]

          if @global_position
            
            t = @global_position.split(",")
            
            data[:lat] = t[0].to_f #15.8700+0.01*Math.cos(Time.now.to_i*Math::PI/180)
            data[:lng] = t[1].to_f #100.9925+0.01*Math.sin(Time.now.to_i*Math::PI/180)
          
          end
          
          #   puts data.inspect  if device_id=='191.1.2.2'

         msg = <<MSG
Data.Sensing device_id=#{name}
#{{'station'=>name, 'stamp' => stamp, 'ref' => ref, 'msg'=>station_msg, 'data'=>data}.to_json}
MSG


          queue << msg

          if response == nil

            ws = MIOT::connect 


          end


        end



        # end filter
     
      end




      rescue Exception=>e
        puts e.inspect
        puts e.backtrace
        puts "Device ID #{device_id}"      
      end



    end

  end


  def self.monitor_iacs_m540 ws

    puts "-- Start IACS M540 Service"


    name = 'Bed01'

    def tabular data, cols = 20 , out = STDOUT


      data.each_with_index do |i,index|

        out.print "#{index}.\t" if index % cols == 0

        out.print "#{i}\t"

        out.puts if index % cols == cols -1

      end

    end

    def variant_detection tmp, data


      # tmp = stmp[k]

      result = []



      data.each_with_index do |i,index|

        count = 0 
        list = []

        for j in tmp
          if j[index]!=data[index]
            count +=1

          end
          list << j[index]
        end

        if count > 1
          list << data[index]
          u = list.uniq
          puts "variant\t#{index}\t#{u.size}\t#{u.join(",")}#{}\t"
        end

      end

      tmp << data

      # tmp.delete_at(0) if tmp.size==20
      # puts
    end


    def self.demo ws


      lead_idx = 0
      leads =  [0,0,0,0,0,0]

      100.times do |x|
        begin
          puts 'Start Receive Dataf'

          ref = '1234'
          name = 'Bed04'
          now = Time.now
          stamp = now.to_json

          bp_stamp = now
          data = {}

          wave = []


          lead_template = [700, 876, 880, 588, 304, 40, -168, -216, -204, -120, -76, -96, -92, -76, -76, -88, -84, -76, -84, -72, -72, -72, -80, -68, -76, -80, -68, -64, -72, -64, -60, -68, -72, -60, -60, -48, -16, 16, 52, 80, 124, 160, 196, 220, 240, 260, 284, 300, 312, 316, 320, 320, 320, 312, 300, 276, 264, 236, 200, 152, 108, 68, 20, -32, -68, -96, -124, -132, -144, -148, -136, -128, -124, -120, -120, -124, -116, -116, -112, -112, -112, -112, -112, -108, -104, -104, -104, -104, -100, -84, -80, -72, -68, -64, -60, -52, -48, -44, -40, -36, -36, -36, -36, -20, 8, 48, 88, 116, 128, 140, 152, 148, 144, 128, 112, 84, 60, 24, -20, -48, -56, -60, -52, -48, -48, -48, -48, -48, -48, -44, -44, -44, -44, -44, -44, -44, -64, -108, -140, -100, 80, 340, 604, 824]

          w = 2
          rps =32
          s = 4

          max = 1024
          min = -1024

          rps.times do |i|

            # y = Math.sin(300*w/rps*i*Math::PI/180)*rand()*50+50
            #   wave << format("%.3f",y).to_f
            #
            wave <<  50-(lead_template[lead_idx*s].to_f / 1024) *50
            lead_idx += 1
            lead_idx = 0 if lead_idx*s > lead_template.size

            # period += rand(10)
          end


          rps2 = 64
          s2 = 2

          # puts wave

          data[:wave] = wave


          data[:leads] = {} unless data[:leads]


          6.times do |x|

            # data[:leads][x] = [] unless data[:leads][x] 

            id = leads[x]
            wave = []

            rps2.times do |i|


              # wave <<  50-(lead_template[id*s2].to_f / 1024) *50
              wave << lead_template[id*s2] if lead_template[id*s2] 
              id += 1
              id = 0 if id*s2 > lead_template.size

              # period += rand(10)
            end
            data[:leads][x] = wave

            leads[x] = id

          end 



          data[:bp] = '120/90'
          data[:pr] = 60 + rand(60)
          data[:hr] = data[:pr]
          data[:rr] = 18 + rand(4)
          data[:temp] = 36 + rand(4)
          data[:spo2] = 90+rand(10)
          data[:bp_stamp] = bp_stamp.strftime("%H%M%S")
          msg = <<MSG
Data.Sensing device_id=#{name}
#{{'station'=>name, 'stamp' => stamp, 'ref' => ref, 'data'=>data}.to_json}
MSG
          # puts msg

          puts 'Start Sent Data '+msg

          ws.send(msg)

        rescue Exception=>e
          puts e.inspect
        end

        sleep(1)

      end


    end

    # self.demo ws




    #========================================================================================
    #========================================================================================
    #========================================================================================



    socket = UDPSocket.new


    thread =  Thread.new {


      dis_socket = UDPSocket.new

      membership = IPAddr.new(M540_DIS_MULTICAST_ADDR).hton + IPAddr.new(M540_BIND_ADDR_LOCAL).hton


      puts 'Start Sent Data'
      dis_socket.setsockopt(:IPPROTO_IP, :IP_ADD_MEMBERSHIP, membership)


      # open port
      dis_socket.bind('0.0.0.0', M540_DIS_PORT)




      puts 'Start Monitor Discovery'


      ip_map = {}


      while true do

        begin

          message, info = dis_socket.recvfrom(4096)
          l = message.each_byte.to_a.collect{|i| i.to_i}  



          ip = info[2]


          unless ip_map[ip]

            # k = fork{
            puts "add new monitor #{ip}"
            add_monitor socket, ip


            # }

            ip_map[ip] = true


          end

        rescue Exception=>e
          puts e.inspect

        end

      end

    }

    thread.run


    # puts 'xxxxxxxx'


    pt_thread =  Thread.new {



      dis_socket = UDPSocket.new

      membership = IPAddr.new(M540_PT_MULTICAST_ADDR).hton + IPAddr.new(M540_BIND_ADDR_LOCAL).hton


      puts 'Start Sent Data'
      dis_socket.setsockopt(:IPPROTO_IP, :IP_ADD_MEMBERSHIP, membership)


      # open port
      dis_socket.bind('0.0.0.0', M540_PT_PORT)



      ip_map = {}


      while true do

        begin

          message, info = dis_socket.recvfrom(4096)
          l = message.each_byte.to_a.collect{|i| i.to_i}  

          # tabular l, 20


        rescue Exception=>e
          puts e.inspect

        end

      end

    }

    pt_thread.run


    queue = []
    
    thread_pool = {}

    media_thread = Thread.new {


      EventMachine.run {


        xv = Time.now.to_f

        EM.add_periodic_timer(1) do

          begin
            unless ws.open?
              sleep 5
              ws.close
              ws = MIOT::connect
            end
            
            if thread_pool.keys.size > 5
              
              puts 'clear thread pool'
              
              thread_pool.each_pair do |k,v|
                v.terminate
              end
              
              ws.close
              ws = MIOT::connect
              thread_pool.clear
              
            end
            
            send_thread = Thread.new {
                
              t = Time.now.to_f

              qtemp = queue.shift queue.size
              
              msg = qtemp.join("\nEOL\n")
              
              if qtemp.size <= 32 
                
              

                ws.send msg

                puts "WS = #{ws.open?} TP = #{ thread_pool.keys.size } Queue = #{qtemp.size} #{msg.size/1000}KB #{(Time.now.to_f-t)*1000}ms #{Time.now.to_f-xv}"
                
              end
              
              thread_pool.delete send_thread.hash

            }

            send_thread.run
            
            thread_pool[send_thread.hash] = send_thread
            
            

          rescue Exception=>e

            puts e.inspect 

          end

        end



      } 

    } 

    media_thread.run

    
    start_monitor socket, ws , queue

    thread.join

    media_thread.join

  end
end

