import { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ChannelType, 
  PermissionsBitField,
  Partials 
} from 'discord.js';
import config from './config/config.json' assert { type: 'json' };
import Enmap from 'enmap';

const client = new Client({
  allowedMentions: {
    parse: ['users', 'roles'],
    repliedUser: true
  },
  partials: [Partials.Channel, Partials.Message],
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent // Necesario para leer el contenido de los mensajes
  ]
});

// Base de datos
const db = new Enmap({
  name: 'db',
  dataDir: './db',
});

// Tickets
const tickets = new Enmap({
  name: 'tickets',
  dataDir: './tickets',
});

const setups = new Enmap({
  name: 'setups',
  dataDir: './welcome',
})

client.login(config.userToken); // Inicia sesión en el bot con el userToken de config.json

// Mensaje de encendido
client.on('ready', () => {
  console.log(`${client.user.tag} está en línea!`);
});

// Comandos
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot || !message.channel) return;

  const args = message.content.slice(config.prefix.length).trim().split(" ");
  const command = args.shift()?.toLowerCase();

  if (!message.content.startsWith(config.prefix) || !command) return;

  setups.ensure(message.guild.id, {
    welcomeChannel: "",
    welcomeMessage: ""
  });

  db.ensure(message.guild.id, {
    channel: "",
    message: "",
    category: "",
  }); // Asegúrate de que el servidor tiene un sistema de tickets configurado

  if (command === 'ping') {
    await message.reply(`El ping del BOT es ${client.ws.ping}ms`);
  }

  if (command === 'disconnect') { // Comando para desconectar el bot
    await message.reply('El bot se está desconectando...');
    client.destroy();
  }

  if (command === 'setup') {
    let channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]); // Obtén el canal mencionado o el primer argumento si es un ID
    if (!channel) return message.reply('No se ha mencionado un canal o no se ha proporcionado un ID válido.'); // Si no hay canal, responde con un mensaje de error

    const msg = await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('📥 Crea un ticket')
        .setDescription(`Haz click en el botón que dice \`📥 Crea un ticket\`.`)
        .setColor('#2f3136')
        .setTimestamp()
      ],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Success)
          .setLabel('Crea un ticket')
          .setEmoji('📥')
          .setCustomId('newticket')
      )]
    }); // Envía el embed con el botón para crear un ticket

    db.set(message.guild.id, channel.id, 'channel'); // Establece el ID del canal en la base de datos
    db.set(message.guild.id, channel.parentId, 'category'); // Establece el ID de la categoría en la base de datos
    db.set(message.guild.id, msg.id, 'message'); // Establece el ID del mensaje en la base de datos

    return message.reply(`✅ Sistema de tickets configurado en el canal ${channel}`); // Responde con un mensaje de éxito
  }

  if(command == "setup-welcome") {
    const uso = "**Uso:** \` ${config.prefix}setup-welcome <#CANAL i ID> <Mensaje de bienvenida>\`";
    const msg = args.slice(1).join(" ");
    const channel = message.guild.channels.cache.get(args[0]) || message.mentions.channels.first();
    let obj = {
      welcomeChannel: channel.id,
      welcomeMessage: msg
    }
    
    !channel && message.reply(`El canal que has encoinado no existe!\n` + uso);
    !msg && message.reply(`No has especificado el mensaje de bienvenida!\n` + uso);

    setups.set(message.guild.id, obj);
  
    return message.reply(`✅ Sistema de bienvenida configurado.\n**Canal**: ${channel}.\n**Mensaje**: ${msg}`);

  }
});

client.on('interactionCreate', async (interaction) => {

  console.log('Interaction received:', interaction.customId);

  if (!interaction.isButton() || !interaction.guildId || interaction.message.author.id !== client.user.id) {
    console.log('Interaction ignored.');
    return;
  }

  db.ensure(interaction.guildId, { // interaction.guildId es el ID del servidor
    channel: '', // data.channel es el ID del canal donde se envió el embed con el botón, no del nuevo canal recién creado
    message: '',
    category: '',
  }); // db.ensure devuelve un objeto vacío si no existe la clave en la base de datos

  const data = db.get(interaction.guildId);
  console.log('Database data:', data);

  // Caso 1: Crear un nuevo ticket
  if (interaction.customId === 'newticket' && interaction.channelId === data.channel && interaction.message.id === data.message) {
    console.log('Creating new ticket for user:', interaction.user.id);

    // Comprobar si el usuario ya tiene un ticket abierto
    const existingTicket = tickets.find(ticket => ticket.userId === interaction.user.id && !ticket.closed);
    if (existingTicket) {
      console.log('User already has an open ticket:', existingTicket.channelId);
      return interaction.reply({ content: `❌ Ya tienes un ticket creado en <#${existingTicket.channelId}>`, ephemeral: true });
    }

    await interaction.reply({ content: '✅ Creando ticket, por favor espere...', ephemeral: true });

    try {
      // Crear el canal
      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.member.displayName}`,
        type: ChannelType.GuildText,
        parent: data.category,
        permissionOverwrites: [
          {
            id: interaction.guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
          },
          {
            id: interaction.user.id,
            allow: [PermissionsBitField.Flags.ViewChannel]
          }
        ]
      });
      console.log('Channel created:', channel.id);

      // Enviar mensaje al canal
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Nuevo ticket de ${interaction.member.displayName}`)
            .setDescription('Por favor, describe tu problema en este canal.')
            .setColor('#2f3136')
            .setTimestamp()
        ],
        components: [
          new ActionRowBuilder().addComponents([
            new ButtonBuilder()
              .setStyle(ButtonStyle.Danger)
              .setLabel('Cerrar ticket')
              .setEmoji('🔒')
              .setCustomId('closeticket'),
            new ButtonBuilder()
              .setStyle(ButtonStyle.Secondary)
              .setLabel('Borrar Ticket')
              .setEmoji('🗑️')
              .setCustomId('deleteticket')
          ])
        ]
      });

      // Guardar el ticket en la base de datos
      tickets.set(channel.id, {
        userId: interaction.user.id,
        channelId: channel.id,
        closed: false,
      });
      console.log('Ticket saved to database:', channel.id);

      return await interaction.editReply({ content: `✅ Ticket creado correctamente en ${channel}`, ephemeral: true });
    } catch (error) {
      console.error('Error al crear el canal o enviar el mensaje:', error);
      await interaction.editReply({ content: '❌ Hubo un error al crear el ticket.', ephemeral: true });
    }

  // Caso 2: Cerrar un ticket existente
  } else if (interaction.customId === 'closeticket') {
    console.log('Closing ticket for channel:', interaction.channelId);

    const ticket = tickets.get(interaction.channelId);

    if (ticket) {
      if (ticket.closed) {
        console.log('Ticket already closed:', interaction.channelId);
        return interaction.reply({ content: '❌ El ticket ya está cerrado.', ephemeral: true });
      }

      await interaction.reply({ content: '✅ El ticket se cerrará en 5 segundos.', ephemeral: true });

      setTimeout(async () => {
        await interaction.editReply({ content: '✅ El ticket se cerró correctamente.', ephemeral: true });
        ticket.closed = true;
        tickets.set(interaction.channelId, ticket);

        // Modificar los permisos para que el usuario no pueda escribir en el canal, pero los admins sí
        await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false });
        await interaction.channel.permissionOverwrites.edit(ticket.userId, { 
            SendMessages: false, 
            AddReactions: false 
        });

        // Añadir permisos para los administradores
        const adminRole = interaction.guild.roles.cache.find(role => role.permissions.has(PermissionsBitField.Flags.Administrator));
        if (adminRole) {
            await interaction.channel.permissionOverwrites.edit(adminRole.id, {
                ViewChannel: true,
                SendMessages: true,
                ManageMessages: true,
                AddReactions: true
            });
        }

        console.log('Ticket closed and permissions updated:', interaction.channelId);
      }, 5000);

    } else {
      console.log('Ticket not found for channel:', interaction.channelId);
      return interaction.reply({ content: '❌ No se encontró el ticket.', ephemeral: true });
    }

  // Caso 3: Eliminar un ticket existente
  } else if (interaction.customId === 'deleteticket') {
    console.log('Deleting ticket for channel:', interaction.channelId);

    const ticket = tickets.get(interaction.channelId);

    if (ticket) {
      await interaction.reply({ content: '✅ El ticket se eliminará en 5 segundos.', ephemeral: true });

      setTimeout(async () => {
        await interaction.channel.delete();
        tickets.delete(interaction.channelId);
        console.log('Ticket deleted from database:', interaction.channelId);
      }, 5000);

    } else {
      console.log('Ticket not found for channel:', interaction.channelId);
      return interaction.reply({ content: '❌ No se encontró el ticket.', ephemeral: true });
    }

  } else {
    console.log('Interaction does not match any active ticket setup.');
  }
});

// Escuchar eventos de eliminación de canales para limpiar la base de datos
client.on('channelDelete', (channel) => {
  console.log('Channel deleted:', channel.id);
  if (tickets.has(channel.id)) {
    tickets.delete(channel.id);
    console.log('Ticket deleted from database:', channel.id);
  }
});

client.on("guildMemberAdd", async (member) => {
  setups.ensure(member.guild.id, {
    welcomeChannel: null,
    welcomeMessage: ""
  });

  try {
    const data = setups.get(member.guild.id);
    if (data){
      if(member.guild.channels.cache.get(data.welcomeChannel)){
        const channel = member.guild.channels.cache.get(data.welcomeChannel);
        channel.send(
          data.welcomeMessage
            .replace(/{usuario}/, member.displayName)
            .replace(/{servidor}/, member.guild.name)
        );
      }
    }
  } catch (error) {
    
  }
})